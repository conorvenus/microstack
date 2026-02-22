import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { AppBreadcrumbs } from "@/components/navigation/AppBreadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_RUNTIME, STORAGE_KEY, normalizeRuntimeUrl } from "@/features/dashboard";
import { listLambdaFunctions } from "@/features/runtime/api";

function formatLastModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function LambdaFunctionsPage(): ReactElement {
  const runtimeOrigin = normalizeRuntimeUrl(window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RUNTIME);

  const lambdaFunctionsQuery = useQuery({
    queryKey: ["lambda-functions", runtimeOrigin],
    queryFn: ({ signal }) => {
      if (!runtimeOrigin) {
        throw new Error("Runtime URL is invalid.");
      }
      return listLambdaFunctions(runtimeOrigin, signal);
    },
    enabled: runtimeOrigin !== null,
  });

  return (
    <ScrollArea className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground">
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <AppBreadcrumbs />

          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">Lambda Functions</CardTitle>
              <CardDescription>
                Browse Lambda functions managed by your current MicroStack runtime configuration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Runtime</th>
                      <th className="px-4 py-3 font-medium">Last Modified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/40 text-slate-200">
                    {runtimeOrigin === null ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-slate-400">
                          Runtime URL is invalid. Set a valid URL on the Dashboard page.
                        </td>
                      </tr>
                    ) : lambdaFunctionsQuery.isLoading || !lambdaFunctionsQuery.data ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-slate-400">
                          Loading Lambda functions...
                        </td>
                      </tr>
                    ) : lambdaFunctionsQuery.isError ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-rose-300">
                          Failed to load Lambda functions from runtime endpoint.
                        </td>
                      </tr>
                    ) : lambdaFunctionsQuery.data.Functions.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-slate-400">
                          No Lambda functions found.
                        </td>
                      </tr>
                    ) : (
                      lambdaFunctionsQuery.data.Functions.map((fn) => (
                        <tr key={fn.FunctionName}>
                          <td className="px-4 py-3">
                            <Link
                              to={`/lambda/${encodeURIComponent(fn.FunctionName)}`}
                              className="text-sky-300 transition-colors hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                            >
                              {fn.FunctionName}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{fn.Runtime}</td>
                          <td className="px-4 py-3">{formatLastModified(fn.LastModified)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </ScrollArea>
  );
}
