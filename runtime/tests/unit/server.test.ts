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
});
