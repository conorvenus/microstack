import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvokeCommand,
  LambdaClient,
  ListFunctionsCommand,
  ResourceConflictException,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import AdmZip from "adm-zip";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

function createFunctionZip(source: string): Uint8Array {
  const zip = new AdmZip();
  zip.addFile("index.mjs", Buffer.from(source, "utf8"));
  return zip.toBuffer();
}

function decodePayload(payload?: Uint8Array): unknown {
  if (!payload) {
    return undefined;
  }

  const raw = Buffer.from(payload).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

describe("Lambda contract (AWS SDK)", () => {
  let server: MicrostackServer;
  let client: LambdaClient;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "microstack-lambda-"));
    server = await createMicrostackServer({ dataDir, port: 0 });

    client = new LambdaClient({
      endpoint: server.endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
  });

  afterAll(async () => {
    client.destroy();
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates, gets, lists, and deletes functions", async () => {
    const code = createFunctionZip(`
      export async function handler(event) {
        return { ok: true, received: event };
      }
    `);

    const created = await client.send(
      new CreateFunctionCommand({
        FunctionName: "hello-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: { ZipFile: code },
        Timeout: 2,
        Environment: { Variables: { STAGE: "dev" } },
      }),
    );

    expect(created.FunctionName).toBe("hello-fn");
    expect(created.Runtime).toBe("nodejs20.x");

    await expect(
      client.send(
        new CreateFunctionCommand({
          FunctionName: "hello-fn",
          Runtime: "nodejs20.x",
          Role: "arn:aws:iam::000000000000:role/lambda-role",
          Handler: "index.handler",
          Code: { ZipFile: code },
        }),
      ),
    ).rejects.toBeInstanceOf(ResourceConflictException);

    const fetched = await client.send(new GetFunctionCommand({ FunctionName: "hello-fn" }));
    expect(fetched.Configuration?.FunctionName).toBe("hello-fn");
    expect(fetched.Configuration?.Handler).toBe("index.handler");

    const listed = await client.send(new ListFunctionsCommand({}));
    const names = (listed.Functions ?? []).map((fn) => fn.FunctionName);
    expect(names).toContain("hello-fn");

    await client.send(new DeleteFunctionCommand({ FunctionName: "hello-fn" }));
    await expect(client.send(new GetFunctionCommand({ FunctionName: "hello-fn" }))).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });

  it("invokes function and supports code/config updates", async () => {
    await client.send(
      new CreateFunctionCommand({
        FunctionName: "mutating-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: {
          ZipFile: createFunctionZip(`
            export async function handler(event) {
              return { version: 1, stage: process.env.STAGE ?? null, event };
            }
          `),
        },
        Timeout: 2,
      }),
    );

    const first = await client.send(
      new InvokeCommand({
        FunctionName: "mutating-fn",
        Payload: Buffer.from(JSON.stringify({ hello: "world" })),
      }),
    );

    expect(first.StatusCode).toBe(200);
    expect(decodePayload(first.Payload)).toEqual({
      version: 1,
      stage: null,
      event: { hello: "world" },
    });

    await client.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: "mutating-fn",
        Environment: { Variables: { STAGE: "test" } },
      }),
    );

    await client.send(
      new UpdateFunctionCodeCommand({
        FunctionName: "mutating-fn",
        ZipFile: createFunctionZip(`
          export async function handler(event) {
            return { version: 2, stage: process.env.STAGE ?? null, event };
          }
        `),
      }),
    );

    const second = await client.send(
      new InvokeCommand({
        FunctionName: "mutating-fn",
        Payload: Buffer.from(JSON.stringify({ changed: true })),
      }),
    );

    expect(second.StatusCode).toBe(200);
    expect(decodePayload(second.Payload)).toEqual({
      version: 2,
      stage: "test",
      event: { changed: true },
    });
  });

  it("maps invocation errors and timeout behavior", async () => {
    await client.send(
      new CreateFunctionCommand({
        FunctionName: "error-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: {
          ZipFile: createFunctionZip(`
            export async function handler() {
              throw new Error("boom");
            }
          `),
        },
        Timeout: 2,
      }),
    );

    const thrown = await client.send(new InvokeCommand({ FunctionName: "error-fn" }));
    expect(thrown.StatusCode).toBe(200);
    expect(thrown.FunctionError).toBe("Unhandled");
    expect(decodePayload(thrown.Payload)).toEqual({
      errorType: "Error",
      errorMessage: "boom",
    });

    await client.send(
      new CreateFunctionCommand({
        FunctionName: "timeout-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: {
          ZipFile: createFunctionZip(`
            export async function handler() {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              return { ok: true };
            }
          `),
        },
        Timeout: 1,
      }),
    );

    const timedOut = await client.send(new InvokeCommand({ FunctionName: "timeout-fn" }));
    expect(timedOut.StatusCode).toBe(200);
    expect(timedOut.FunctionError).toBe("Unhandled");
    expect(decodePayload(timedOut.Payload)).toEqual({
      errorType: "TimeoutError",
      errorMessage: "Task timed out after 1.00 seconds",
    });

    await expect(client.send(new InvokeCommand({ FunctionName: "does-not-exist" }))).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });
});
