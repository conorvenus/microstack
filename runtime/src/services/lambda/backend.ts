import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { HttpError } from "../../http-error.js";
import type {
  CreateFunctionInput,
  FunctionConfig,
  InvokeResult,
  LambdaBackend,
  UpdateFunctionCodeInput,
  UpdateFunctionConfigurationInput,
} from "./types.js";

class TimeoutError extends Error {
  public constructor(seconds: number) {
    super(`Task timed out after ${seconds.toFixed(2)} seconds`);
    this.name = "TimeoutError";
  }
}

class InMemoryLambdaBackend implements LambdaBackend {
  private readonly functions = new Map<string, FunctionConfig>();
  private readonly runtimeRoot: string;

  public constructor(baseDir?: string) {
    this.runtimeRoot = this.createRuntimeRoot(baseDir ?? join(tmpdir(), "microstack"));
  }

  public createFunction(input: CreateFunctionInput): FunctionConfig {
    if (this.functions.has(input.FunctionName)) {
      throw new HttpError(409, "ResourceConflictException", `Function already exists: ${input.FunctionName}`);
    }

    if (input.Runtime !== "nodejs20.x") {
      throw new HttpError(400, "InvalidParameterValueException", `Unsupported runtime: ${input.Runtime}`);
    }

    if (!input.Code?.ZipFile) {
      throw new HttpError(400, "InvalidParameterValueException", "ZipFile is required");
    }

    const zipFile = Buffer.from(input.Code.ZipFile, "base64");
    const now = new Date().toISOString();
    const fn: FunctionConfig = {
      functionName: input.FunctionName,
      runtime: input.Runtime,
      role: input.Role,
      handler: input.Handler,
      timeout: input.Timeout ?? 3,
      environment: input.Environment?.Variables ?? {},
      zipFile,
      codeSha256: createHash("sha256").update(zipFile).digest("base64"),
      version: 1,
      lastModified: now,
    };

    this.functions.set(fn.functionName, fn);
    return fn;
  }

  public getFunction(name: string): FunctionConfig {
    const fn = this.functions.get(name);
    if (!fn) {
      throw new HttpError(404, "ResourceNotFoundException", `Function not found: ${name}`);
    }

    return fn;
  }

  public listFunctions(): FunctionConfig[] {
    return [...this.functions.values()];
  }

  public deleteFunction(name: string): void {
    if (!this.functions.has(name)) {
      throw new HttpError(404, "ResourceNotFoundException", `Function not found: ${name}`);
    }

    this.functions.delete(name);
  }

  public updateFunctionConfiguration(name: string, input: UpdateFunctionConfigurationInput): FunctionConfig {
    const fn = this.getFunction(name);
    const updated: FunctionConfig = {
      ...fn,
      runtime: input.Runtime ?? fn.runtime,
      role: input.Role ?? fn.role,
      handler: input.Handler ?? fn.handler,
      timeout: input.Timeout ?? fn.timeout,
      environment: input.Environment?.Variables ?? fn.environment,
      lastModified: new Date().toISOString(),
    };

    this.functions.set(name, updated);
    return updated;
  }

  public updateFunctionCode(name: string, input: UpdateFunctionCodeInput): FunctionConfig {
    const fn = this.getFunction(name);

    if (!input.ZipFile) {
      throw new HttpError(400, "InvalidParameterValueException", "ZipFile is required");
    }

    const zipFile = Buffer.from(input.ZipFile, "base64");
    const updated: FunctionConfig = {
      ...fn,
      zipFile,
      codeSha256: createHash("sha256").update(zipFile).digest("base64"),
      version: fn.version + 1,
      lastModified: new Date().toISOString(),
    };

    this.functions.set(name, updated);
    return updated;
  }

  public async invokeFunction(name: string, payload: Buffer): Promise<InvokeResult> {
    const fn = this.getFunction(name);
    const [moduleName, exportName] = fn.handler.split(".");
    if (!moduleName || !exportName) {
      throw new HttpError(400, "InvalidParameterValueException", `Invalid handler format: ${fn.handler}`);
    }

    const invocationDir = mkdtempSync(join(this.runtimeRoot, `${fn.functionName}-${fn.version}-`));
    const zip = new AdmZip(Buffer.from(fn.zipFile));
    zip.extractAllTo(invocationDir, true);

    const handlerPath = this.resolveHandlerFile(invocationDir, moduleName);
    const importUrl = `${pathToFileURL(handlerPath).href}?v=${Date.now()}`;
    const event = payload.byteLength === 0 ? null : JSON.parse(payload.toString("utf8"));

    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(fn.environment)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    try {
      const mod: Record<string, unknown> = await import(importUrl);
      const handler = mod[exportName];
      if (typeof handler !== "function") {
        throw new HttpError(400, "InvalidParameterValueException", `Handler export not found: ${fn.handler}`);
      }

      const result = await this.withTimeout(
        Promise.resolve(handler(event, { awsRequestId: randomUUID() })),
        fn.timeout * 1000,
        fn.timeout,
      );
      return { payload: Buffer.from(JSON.stringify(result ?? null), "utf8") };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (error instanceof TimeoutError) {
        return {
          functionError: "Unhandled",
          payload: Buffer.from(JSON.stringify({ errorType: error.name, errorMessage: error.message }), "utf8"),
        };
      }

      const err = error as Error;
      return {
        functionError: "Unhandled",
        payload: Buffer.from(
          JSON.stringify({
            errorType: err.name || "Error",
            errorMessage: err.message || "Unknown error",
          }),
          "utf8",
        ),
      };
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(invocationDir, { recursive: true, force: true });
    }
  }

  private createRuntimeRoot(baseDir: string): string {
    const root = join(baseDir, "runtime");
    mkdirSync(root, { recursive: true });
    return root;
  }

  private resolveHandlerFile(extractDir: string, moduleName: string): string {
    const candidates = [
      join(extractDir, `${moduleName}.mjs`),
      join(extractDir, `${moduleName}.js`),
      join(extractDir, `${moduleName}.cjs`),
    ];

    for (const candidate of candidates) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new HttpError(400, "InvalidParameterValueException", `Handler module not found: ${moduleName}`);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutSeconds: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new TimeoutError(timeoutSeconds)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

export function createLambdaBackend(options?: { dataDir?: string }): LambdaBackend {
  return new InMemoryLambdaBackend(options?.dataDir);
}
