import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

describe("microstack route mounting", () => {
  let server: MicrostackServer;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves microstack health endpoint", async () => {
    const response = await fetch(`${server.endpoint}/microstack/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns aws-style not-found for unknown microstack routes", async () => {
    const response = await fetch(`${server.endpoint}/microstack/unknown`);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-amzn-errortype")).toBe("ResourceNotFoundException");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns not-found for unsupported microstack health methods", async () => {
    const response = await fetch(`${server.endpoint}/microstack/health`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-amzn-errortype")).toBe("ResourceNotFoundException");
  });

  it("handles preflight requests", async () => {
    const response = await fetch(`${server.endpoint}/microstack/health`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
  });
});
