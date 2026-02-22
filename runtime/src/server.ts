import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createCloudWatchLogsBackend, createCloudWatchLogsRouteHandler } from "./services/cloudwatch-logs/index.js";
import { createLambdaBackend, createLambdaRouteHandler } from "./services/lambda/index.js";
import { createMicrostackRouteHandler } from "./services/microstack/index.js";
import { HttpError } from "./http-error.js";

export interface MicrostackServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
}

export interface MicrostackServer {
  endpoint: string;
  close: () => Promise<void>;
}

export { HttpError };

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "Content-Type,Authorization,X-Amz-Target,X-Amz-Security-Token,X-Amz-Date",
};

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    "content-type": "application/json",
    "content-length": String(payload.byteLength),
    ...headers,
  });
  res.end(payload);
}

export function sendBinary(
  res: ServerResponse,
  statusCode: number,
  payload: Uint8Array,
  headers?: Record<string, string>,
): void {
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    "content-type": "application/json",
    "content-length": String(payload.byteLength),
    ...headers,
  });
  res.end(Buffer.from(payload));
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(
      res,
      error.statusCode,
      {
        message: error.message,
        __type: error.code,
      },
      {
        "x-amzn-errortype": error.code,
      },
    );
    return;
  }

  const err = error as Error;
  sendJson(
    res,
    500,
    { message: err.message || "Internal Server Error", __type: "InternalServerError" },
    { "x-amzn-errortype": "InternalServerError" },
  );
}

export async function createMicrostackServer(options: MicrostackServerOptions = {}): Promise<MicrostackServer> {
  const host = options.host ?? "127.0.0.1";
  const cloudWatchLogsBackend = createCloudWatchLogsBackend();
  const lambdaBackend = createLambdaBackend({
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    invocationLogger: (record) => {
      const logGroupName = `/aws/lambda/${record.functionName}`;
      const date = new Date(record.timestamp).toISOString().slice(0, 10).split("-").join("/");
      const logStreamName = `${date}/[$LATEST]${record.requestId}`;
      const payloadText = Buffer.from(record.payload).toString("utf8");

      cloudWatchLogsBackend.putLogEvent(logGroupName, logStreamName, `START RequestId: ${record.requestId}`, record.timestamp);
      cloudWatchLogsBackend.putLogEvent(
        logGroupName,
        logStreamName,
        record.functionError ? `ERROR ${payloadText}` : `RESULT ${payloadText}`,
        record.timestamp + 1,
      );
      cloudWatchLogsBackend.putLogEvent(logGroupName, logStreamName, `END RequestId: ${record.requestId}`, record.timestamp + 2);
    },
  });
  const handleMicrostackRoute = createMicrostackRouteHandler();
  const handleLambdaRoute = createLambdaRouteHandler(lambdaBackend);
  const handleCloudWatchLogsRoute = createCloudWatchLogsRouteHandler(cloudWatchLogsBackend);

  const server: Server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        throw new HttpError(404, "ResourceNotFoundException", "Not found");
      }

      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      if (method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      if (await handleMicrostackRoute(req, res, pathname, method)) {
        return;
      }

      if (await handleLambdaRoute(req, res, pathname, method)) {
        return;
      }

      if (await handleCloudWatchLogsRoute(req, res, pathname, method)) {
        return;
      }

      throw new HttpError(404, "ResourceNotFoundException", "Not found");
    } catch (error) {
      sendError(res, error);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server failed to start");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
