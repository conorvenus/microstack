import type { ZodType } from "zod";

import type { HealthState } from "@/features/dashboard";

import { HEALTH_PATH, REQUEST_TIMEOUT_MS } from "../dashboard/constants";
import {
  describeLogGroupsResponseSchema,
  describeLogStreamsResponseSchema,
  getLambdaFunctionResponseSchema,
  getLogEventsResponseSchema,
  healthResponseSchema,
  invokeLambdaResultSchema,
  lambdaListResponseSchema,
  type DescribeLogGroupsResponse,
  type DescribeLogStreamsResponse,
  type GetLambdaFunctionResponse,
  type GetLogEventsResponse,
  type InvokeLambdaResult,
  type LambdaListResponse,
} from "./schemas";

const LAMBDA_FUNCTIONS_PATH = "/2015-03-31/functions";

type RuntimeHealthResult = {
  healthState: HealthState;
  checkedAt: Date;
};

type RequestJsonOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

type AwsJsonOptions = RequestJsonOptions & {
  target: string;
  body: Record<string, unknown>;
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

async function requestAwsJson<T>(runtimeOrigin: string, schema: ZodType<T>, options: AwsJsonOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${runtimeOrigin}/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": options.target,
      },
      body: JSON.stringify(options.body),
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

export function getLambdaFunction(
  runtimeOrigin: string,
  functionName: string,
  signal?: AbortSignal,
): Promise<GetLambdaFunctionResponse> {
  return requestJson(
    `${runtimeOrigin}${LAMBDA_FUNCTIONS_PATH}/${encodeURIComponent(functionName)}`,
    getLambdaFunctionResponseSchema,
    { signal },
  );
}

export async function invokeLambdaFunction(
  runtimeOrigin: string,
  functionName: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<InvokeLambdaResult> {
  const timeoutMs = REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(
      `${runtimeOrigin}${LAMBDA_FUNCTIONS_PATH}/${encodeURIComponent(functionName)}/invocations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payloadText = await response.text();
    let payloadJson: unknown | undefined;
    try {
      payloadJson = payloadText.length > 0 ? JSON.parse(payloadText) : undefined;
    } catch {
      payloadJson = undefined;
    }

    return invokeLambdaResultSchema.parse({
      statusCode: response.status,
      executedVersion: response.headers.get("x-amz-executed-version") ?? undefined,
      functionError: response.headers.get("x-amz-function-error") ?? undefined,
      payloadText,
      payloadJson,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function describeLogGroups(runtimeOrigin: string, signal?: AbortSignal): Promise<DescribeLogGroupsResponse> {
  return requestAwsJson(runtimeOrigin, describeLogGroupsResponseSchema, {
    target: "Logs_20140328.DescribeLogGroups",
    body: {},
    signal,
  });
}

export function describeLogStreams(
  runtimeOrigin: string,
  logGroupName: string,
  signal?: AbortSignal,
): Promise<DescribeLogStreamsResponse> {
  return requestAwsJson(runtimeOrigin, describeLogStreamsResponseSchema, {
    target: "Logs_20140328.DescribeLogStreams",
    body: { logGroupName },
    signal,
  });
}

export function getLogEvents(
  runtimeOrigin: string,
  logGroupName: string,
  logStreamName: string,
  signal?: AbortSignal,
): Promise<GetLogEventsResponse> {
  return requestAwsJson(runtimeOrigin, getLogEventsResponseSchema, {
    target: "Logs_20140328.GetLogEvents",
    body: { logGroupName, logStreamName },
    signal,
  });
}
