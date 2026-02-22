import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../../server.js";

export type MicrostackRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
) => Promise<boolean>;

export function createMicrostackRouteHandler(): MicrostackRouteHandler {
  return async (_req, res, pathname, method) => {
    if (!pathname.startsWith("/microstack")) {
      return false;
    }

    if (method === "GET" && pathname === "/microstack/health") {
      sendJson(res, 200, { status: "ok" });
      return true;
    }

    return false;
  };
}
