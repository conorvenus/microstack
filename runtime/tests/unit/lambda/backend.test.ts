import AdmZip from "adm-zip";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../../../src/server.js";
import { createLambdaBackend } from "../../../src/services/lambda/index.js";

function createFunctionZip(source: string): Uint8Array {
  const zip = new AdmZip();
  zip.addFile("index.mjs", Buffer.from(source, "utf8"));
  return zip.toBuffer();
}

function decodePayload(payload: Uint8Array): unknown {
  return JSON.parse(Buffer.from(payload).toString("utf8"));
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("lambda backend", () => {
  it("handles lifecycle and configuration updates", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "microstack-lambda-backend-"));
    tempDirs.push(dataDir);
    const backend = createLambdaBackend({ dataDir });

    const created = backend.createFunction({
      FunctionName: "unit-fn",
      Runtime: "nodejs20.x",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Code: {
        ZipFile: Buffer.from(createFunctionZip("export async function handler() { return { ok: true }; }")).toString(
          "base64",
        ),
      },
    });

    expect(created.version).toBe(1);
    expect(backend.listFunctions()).toHaveLength(1);

    const updatedConfig = backend.updateFunctionConfiguration("unit-fn", {
      Environment: { Variables: { STAGE: "test" } },
      Timeout: 10,
    });
    expect(updatedConfig.environment.STAGE).toBe("test");
    expect(updatedConfig.timeout).toBe(10);

    const updatedCode = backend.updateFunctionCode("unit-fn", {
      ZipFile: Buffer.from(createFunctionZip("export async function handler() { return { ok: false }; }")).toString(
        "base64",
      ),
    });
    expect(updatedCode.version).toBe(2);
  });

  it("maps invocation errors and timeouts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "microstack-lambda-backend-"));
    tempDirs.push(dataDir);
    const backend = createLambdaBackend({ dataDir });

    backend.createFunction({
      FunctionName: "error-fn",
      Runtime: "nodejs20.x",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Timeout: 1,
      Code: {
        ZipFile: Buffer.from(
          createFunctionZip("export async function handler() { throw new Error('boom'); }"),
        ).toString("base64"),
      },
    });

    const errored = await backend.invokeFunction("error-fn", Buffer.from("{}"));
    expect(errored.functionError).toBe("Unhandled");
    expect(decodePayload(errored.payload)).toEqual({ errorType: "Error", errorMessage: "boom" });

    backend.createFunction({
      FunctionName: "timeout-fn",
      Runtime: "nodejs20.x",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Timeout: 1,
      Code: {
        ZipFile: Buffer.from(
          createFunctionZip(
            "export async function handler() { await new Promise((r) => setTimeout(r, 1500)); return { ok: true }; }",
          ),
        ).toString("base64"),
      },
    });

    const timedOut = await backend.invokeFunction("timeout-fn", Buffer.alloc(0));
    expect(timedOut.functionError).toBe("Unhandled");
    expect(decodePayload(timedOut.payload)).toEqual({
      errorType: "TimeoutError",
      errorMessage: "Task timed out after 1.00 seconds",
    });
  });

  it("throws aws-style errors for conflicts and missing resources", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "microstack-lambda-backend-"));
    tempDirs.push(dataDir);
    const backend = createLambdaBackend({ dataDir });

    const code = Buffer.from(createFunctionZip("export async function handler() { return null; }")).toString("base64");

    backend.createFunction({
      FunctionName: "dup-fn",
      Runtime: "nodejs20.x",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Code: { ZipFile: code },
    });

    expect(() =>
      backend.createFunction({
        FunctionName: "dup-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: { ZipFile: code },
      }),
    ).toThrowError(HttpError);

    expect(() => backend.getFunction("missing")).toThrowError(HttpError);
  });
});
