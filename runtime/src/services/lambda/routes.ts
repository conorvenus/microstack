import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../http-error.js";
import { readBody, readJson, sendBinary, sendJson } from "../../server.js";
import type {
  CreateFunctionInput,
  FunctionConfig,
  LambdaBackend,
  UpdateFunctionCodeInput,
  UpdateFunctionConfigurationInput,
} from "./types.js";

function toFunctionConfiguration(fn: FunctionConfig): Record<string, unknown> {
  return {
    FunctionName: fn.functionName,
    FunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:${fn.functionName}`,
    Runtime: fn.runtime,
    Role: fn.role,
    Handler: fn.handler,
    Timeout: fn.timeout,
    LastModified: fn.lastModified,
    Version: "$LATEST",
    CodeSha256: fn.codeSha256,
    CodeSize: fn.zipFile.byteLength,
    Environment: {
      Variables: fn.environment,
    },
    State: "Active",
    PackageType: "Zip",
  };
}

function parseFunctionName(pathname: string): string {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  const index = parts.findIndex((part) => part === "functions");
  const functionName = index === -1 ? undefined : parts[index + 1];
  if (!functionName) {
    throw new HttpError(404, "ResourceNotFoundException", "Function not found");
  }

  return decodeURIComponent(functionName);
}

export type LambdaRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
) => Promise<boolean>;

export function createLambdaRouteHandler(backend: LambdaBackend): LambdaRouteHandler {
  return async (req, res, pathname, method) => {
    if (!pathname.startsWith("/2015-03-31/functions")) {
      return false;
    }

    if (method === "POST" && pathname === "/2015-03-31/functions") {
      const input = (await readJson(req)) as CreateFunctionInput;
      const created = backend.createFunction(input);
      sendJson(res, 201, toFunctionConfiguration(created));
      return true;
    }

    if (method === "GET" && (pathname === "/2015-03-31/functions" || pathname === "/2015-03-31/functions/")) {
      sendJson(res, 200, { Functions: backend.listFunctions().map((fn) => toFunctionConfiguration(fn)) });
      return true;
    }

    if (method === "GET" && pathname.startsWith("/2015-03-31/functions/")) {
      const name = parseFunctionName(pathname);
      const fn = backend.getFunction(name);
      sendJson(res, 200, {
        Configuration: toFunctionConfiguration(fn),
        Code: {
          RepositoryType: "S3",
          Location: `http://localhost/artifacts/${name}.zip`,
        },
      });
      return true;
    }

    if (method === "DELETE" && pathname.startsWith("/2015-03-31/functions/")) {
      const name = parseFunctionName(pathname);
      backend.deleteFunction(name);
      sendJson(res, 200, {});
      return true;
    }

    if (method === "PUT" && pathname.endsWith("/code")) {
      const name = parseFunctionName(pathname);
      const input = (await readJson(req)) as UpdateFunctionCodeInput;
      const updated = backend.updateFunctionCode(name, input);
      sendJson(res, 200, toFunctionConfiguration(updated));
      return true;
    }

    if (method === "PUT" && pathname.endsWith("/configuration")) {
      const name = parseFunctionName(pathname);
      const input = (await readJson(req)) as UpdateFunctionConfigurationInput;
      const updated = backend.updateFunctionConfiguration(name, input);
      sendJson(res, 200, toFunctionConfiguration(updated));
      return true;
    }

    if (method === "POST" && pathname.endsWith("/invocations")) {
      const name = parseFunctionName(pathname);
      const payload = await readBody(req);
      const result = await backend.invokeFunction(name, payload);
      sendBinary(res, 200, result.payload, {
        "x-amz-executed-version": "$LATEST",
        ...(result.functionError ? { "x-amz-function-error": result.functionError } : {}),
      });
      return true;
    }

    return false;
  };
}
