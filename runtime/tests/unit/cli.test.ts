import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../../src/cli.js";

describe("runtime cli config", () => {
  it("uses defaults when env vars are not set", () => {
    const config = parseRuntimeConfig({});

    expect(config).toEqual({
      host: "0.0.0.0",
      port: 1337,
      dataDir: "/tmp/microstack",
    });
  });

  it("uses env var overrides", () => {
    const config = parseRuntimeConfig({
      MICROSTACK_HOST: "127.0.0.1",
      MICROSTACK_PORT: "9000",
      MICROSTACK_DATA_DIR: "/data/microstack",
    });

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 9000,
      dataDir: "/data/microstack",
    });
  });

  it("rejects invalid port values", () => {
    expect(() => parseRuntimeConfig({ MICROSTACK_PORT: "0" })).toThrowError(/Invalid MICROSTACK_PORT value/);
    expect(() => parseRuntimeConfig({ MICROSTACK_PORT: "70000" })).toThrowError(/Invalid MICROSTACK_PORT value/);
    expect(() => parseRuntimeConfig({ MICROSTACK_PORT: "abc" })).toThrowError(/Invalid MICROSTACK_PORT value/);
  });
});
