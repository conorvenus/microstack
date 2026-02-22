import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createLambdaBackend, createLambdaRouteHandler } from "./services/lambda/index.js";
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

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
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
  const lambdaBackend = createLambdaBackend(options.dataDir ? { dataDir: options.dataDir } : undefined);
  const handleLambdaRoute = createLambdaRouteHandler(lambdaBackend);

  const server: Server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        throw new HttpError(404, "ResourceNotFoundException", "Not found");
      }

      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      if (await handleLambdaRoute(req, res, pathname, method)) {
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
