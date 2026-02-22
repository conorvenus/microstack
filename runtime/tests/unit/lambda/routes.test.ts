import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

describe("lambda route mounting", () => {
  let server: MicrostackServer;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves lambda list endpoint from lambda route module", async () => {
    const response = await fetch(`${server.endpoint}/2015-03-31/functions`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { Functions: unknown[] };
    expect(Array.isArray(body.Functions)).toBe(true);
  });

  it("returns aws-style not-found response for unknown routes", async () => {
    const response = await fetch(`${server.endpoint}/not-a-service`);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-amzn-errortype")).toBe("ResourceNotFoundException");
    const body = (await response.json()) as { __type?: string };
    expect(body.__type).toBe("ResourceNotFoundException");
  });
});
