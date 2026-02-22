import { afterEach, describe, expect, it } from "vitest";
import { createMicrostackServer, type MicrostackServer } from "../../src/index.js";

describe("microstack server options", () => {
  let server: MicrostackServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("supports custom host binding", async () => {
    server = await createMicrostackServer({ host: "0.0.0.0", port: 0 });

    const response = await fetch(`${server.endpoint}/2015-03-31/functions`);
    expect(response.status).toBe(200);
  });

  it("mounts cloudformation route on root path for query protocol", async () => {
    server = await createMicrostackServer({ port: 0 });
    const body = new URLSearchParams({
      Action: "DescribeStacks",
      Version: "2010-05-15",
    });
    const response = await fetch(`${server.endpoint}/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    expect(response.status).not.toBe(404);
  });
});
