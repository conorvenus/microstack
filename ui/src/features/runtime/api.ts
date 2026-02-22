import type { ZodType } from "zod";

import type { HealthState } from "@/features/dashboard";

import { HEALTH_PATH, REQUEST_TIMEOUT_MS } from "../dashboard/constants";
import { healthResponseSchema, lambdaListResponseSchema, type LambdaListResponse } from "./schemas";

const LAMBDA_FUNCTIONS_PATH = "/2015-03-31/functions";

type RuntimeHealthResult = {
  healthState: HealthState;
  checkedAt: Date;
};

type RequestJsonOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

async function requestJson<T>(url: string, schema: ZodType<T>, options?: RequestJsonOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();
    return schema.parse(payload);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getRuntimeHealth(runtimeOrigin: string, signal?: AbortSignal): Promise<RuntimeHealthResult> {
  const checkedAt = new Date();

  try {
    const payload = await requestJson(`${runtimeOrigin}${HEALTH_PATH}`, healthResponseSchema, { signal });
    return {
      healthState: payload.status === "ok" ? "healthy" : "unreachable",
      checkedAt,
    };
  } catch {
    return {
      healthState: "unreachable",
      checkedAt,
    };
  }
}

export function listLambdaFunctions(runtimeOrigin: string, signal?: AbortSignal): Promise<LambdaListResponse> {
  return requestJson(`${runtimeOrigin}${LAMBDA_FUNCTIONS_PATH}`, lambdaListResponseSchema, { signal });
}
