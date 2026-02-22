import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";

import { AppBreadcrumbs } from "@/components/navigation/AppBreadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_RUNTIME, STORAGE_KEY, normalizeRuntimeUrl } from "@/features/dashboard";
import { getLambdaFunction, invokeLambdaFunction } from "@/features/runtime/api";
import type { InvokeLambdaResult } from "@/features/runtime/schemas";

function formatLastModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatPayload(result: InvokeLambdaResult): string {
  if (result.payloadJson !== undefined) {
    return JSON.stringify(result.payloadJson, null, 2);
  }
  return result.payloadText;
}

export function LambdaFunctionDetailPage(): ReactElement {
  const { functionName: rawFunctionName } = useParams<{ functionName: string }>();
  const functionName = rawFunctionName ? decodeURIComponent(rawFunctionName) : null;
  const runtimeOrigin = normalizeRuntimeUrl(window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RUNTIME);

  const [payloadInput, setPayloadInput] = useState("{}");
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [invokeResult, setInvokeResult] = useState<InvokeLambdaResult | null>(null);

  const functionQuery = useQuery({
    queryKey: ["lambda-function-detail", runtimeOrigin, functionName],
    queryFn: ({ signal }) => {
      if (!runtimeOrigin || !functionName) {
        throw new Error("Invalid runtime URL or function name.");
      }
      return getLambdaFunction(runtimeOrigin, functionName, signal);
    },
    enabled: runtimeOrigin !== null && functionName !== null,
  });

  const invokeMutation = useMutation({
    mutationFn: async (payload: unknown) => {
      if (!runtimeOrigin || !functionName) {
        throw new Error("Invalid runtime URL or function name.");
      }
      return invokeLambdaFunction(runtimeOrigin, functionName, payload);
    },
    onSuccess: (result) => {
      setInvokeResult(result);
    },
  });

  const parsedPayload = useMemo(() => {
    try {
      const parsed = JSON.parse(payloadInput) as unknown;
      return { parsed, error: null as string | null };
    } catch {
      return { parsed: null, error: "Payload must be valid JSON." };
    }
  }, [payloadInput]);

  const canInvoke = runtimeOrigin !== null && functionName !== null && parsedPayload.error === null && !invokeMutation.isPending;

  return (
    <ScrollArea className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground">
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <AppBreadcrumbs />

          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">Lambda Function Details</CardTitle>
              <CardDescription>{functionName ? `Function: ${functionName}` : "Missing function name."}</CardDescription>
            </CardHeader>
            <CardContent>
              {runtimeOrigin === null || functionName === null ? (
                <p className="text-slate-400">Runtime URL is invalid or function name is missing.</p>
              ) : functionQuery.isLoading || !functionQuery.data ? (
                <p className="text-slate-400">Loading function configuration...</p>
              ) : functionQuery.isError ? (
                <p className="text-rose-300">Failed to load function details from runtime endpoint.</p>
              ) : (
                <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <span className="text-slate-400">Runtime</span>
                    <div className="mt-1">{functionQuery.data.Configuration.Runtime}</div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <span className="text-slate-400">Handler</span>
                    <div className="mt-1">{functionQuery.data.Configuration.Handler}</div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <span className="text-slate-400">Timeout</span>
                    <div className="mt-1">{functionQuery.data.Configuration.Timeout} seconds</div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <span className="text-slate-400">Last Modified</span>
                    <div className="mt-1">{formatLastModified(functionQuery.data.Configuration.LastModified)}</div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 sm:col-span-2">
                    <span className="text-slate-400">Role</span>
                    <div className="mt-1 break-all">{functionQuery.data.Configuration.Role}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">Manual Invoke</CardTitle>
              <CardDescription>Send a JSON payload and run the function synchronously.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label htmlFor="lambda-payload" className="text-sm text-slate-300">
                JSON Payload
              </label>
              <textarea
                id="lambda-payload"
                value={payloadInput}
                onChange={(event) => {
                  const next = event.target.value;
                  setPayloadInput(next);
                  try {
                    JSON.parse(next);
                    setPayloadError(null);
                  } catch {
                    setPayloadError("Payload must be valid JSON.");
                  }
                }}
                className="min-h-48 w-full rounded-md border border-slate-700 bg-slate-950/90 p-3 font-mono text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                placeholder='{"hello":"world"}'
                spellCheck={false}
              />
              {(payloadError ?? parsedPayload.error) && <p className="text-sm text-rose-300">{payloadError ?? parsedPayload.error}</p>}
              {invokeMutation.isError && <p className="text-sm text-rose-300">Failed to invoke Lambda.</p>}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!canInvoke || parsedPayload.parsed === null) {
                      return;
                    }
                    invokeMutation.mutate(parsedPayload.parsed);
                  }}
                  disabled={!canInvoke}
                  className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {invokeMutation.isPending ? "Running..." : "Run Lambda"}
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">Invocation Result</CardTitle>
              <CardDescription>Result from the most recent manual invocation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!invokeResult ? (
                <p className="text-slate-400">Run the function to see result output.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                      Status: {invokeResult.statusCode}
                    </Badge>
                    <Badge
                      className={
                        invokeResult.functionError
                          ? "bg-rose-500/20 text-rose-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }
                    >
                      {invokeResult.functionError ? `FunctionError: ${invokeResult.functionError}` : "Success"}
                    </Badge>
                    {invokeResult.executedVersion && (
                      <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                        Version: {invokeResult.executedVersion}
                      </Badge>
                    )}
                  </div>
                  <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/90 p-3 font-mono text-xs text-slate-100">
                    {formatPayload(invokeResult)}
                  </pre>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </ScrollArea>
  );
}
