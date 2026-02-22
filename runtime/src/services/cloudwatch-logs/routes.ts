import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../http-error.js";
import { readJson, sendJson } from "../../server.js";
import type { CloudWatchLogsBackend } from "./types.js";

type JsonRecord = Record<string, unknown>;

export type CloudWatchLogsRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
) => Promise<boolean>;

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "InvalidParameterException", `${fieldName} is required`);
  }
  return value;
}

export function createCloudWatchLogsRouteHandler(backend: CloudWatchLogsBackend): CloudWatchLogsRouteHandler {
  return async (req, res, pathname, method) => {
    if (method !== "POST" || pathname !== "/") {
      return false;
    }

    const targetHeader = req.headers["x-amz-target"];
    if (typeof targetHeader !== "string" || !targetHeader.startsWith("Logs_20140328.")) {
      return false;
    }

    const operation = targetHeader.slice("Logs_20140328.".length);
    const input = (await readJson(req)) as JsonRecord;

    if (operation === "DescribeLogGroups") {
      const logGroupNamePrefix = typeof input.logGroupNamePrefix === "string" ? input.logGroupNamePrefix : undefined;
      sendJson(res, 200, { logGroups: backend.describeLogGroups(logGroupNamePrefix) });
      return true;
    }

    if (operation === "DescribeLogStreams") {
      const logGroupName = requireString(input.logGroupName, "logGroupName");
      const logStreamNamePrefix =
        typeof input.logStreamNamePrefix === "string" ? input.logStreamNamePrefix : undefined;
      sendJson(res, 200, { logStreams: backend.describeLogStreams(logGroupName, logStreamNamePrefix) });
      return true;
    }

    if (operation === "GetLogEvents") {
      const logGroupName = requireString(input.logGroupName, "logGroupName");
      const logStreamName = requireString(input.logStreamName, "logStreamName");
      sendJson(res, 200, {
        events: backend.getLogEvents(logGroupName, logStreamName),
        nextForwardToken: "f/00000000000000000000000000000000000000000000000000000000",
        nextBackwardToken: "b/00000000000000000000000000000000000000000000000000000000",
      });
      return true;
    }

    throw new HttpError(400, "UnknownOperationException", `Unsupported CloudWatch Logs operation: ${operation}`);
  };
}
