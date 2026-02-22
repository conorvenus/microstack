import { pathToFileURL } from "node:url";
import { createMicrostackServer } from "./server.js";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 1337;
const DEFAULT_DATA_DIR = "/tmp/microstack";

export interface RuntimeCliConfig {
  host: string;
  port: number;
  dataDir: string;
}

function readString(envValue: string | undefined, fallback: string): string {
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function readPort(envValue: string | undefined, fallback: number): number {
  const trimmed = envValue?.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid MICROSTACK_PORT value: ${trimmed}`);
  }

  return parsed;
}

export function parseRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeCliConfig {
  return {
    host: readString(env.MICROSTACK_HOST, DEFAULT_HOST),
    port: readPort(env.MICROSTACK_PORT, DEFAULT_PORT),
    dataDir: readString(env.MICROSTACK_DATA_DIR, DEFAULT_DATA_DIR),
  };
}

export async function runRuntime(): Promise<void> {
  const config = parseRuntimeConfig();
  const server = await createMicrostackServer({
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
  });

  console.log(
    `[microstack] runtime listening on http://${config.host}:${config.port} (data dir: ${config.dataDir})`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`[microstack] received ${signal}, shutting down`);
    await server.close();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  runRuntime().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[microstack] failed to start runtime: ${message}`);
    process.exitCode = 1;
  });
}
