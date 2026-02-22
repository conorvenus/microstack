import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams, useParams } from "react-router-dom";

import { AppBreadcrumbs } from "@/components/navigation/AppBreadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_RUNTIME, STORAGE_KEY, normalizeRuntimeUrl } from "@/features/dashboard";
import { describeLogStreams, getLogEvents } from "@/features/runtime/api";

function formatTimestamp(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function createPreview(message: string): string {
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}

export function CloudWatchLogStreamPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { logGroupName: rawLogGroupName } = useParams<{ logGroupName: string }>();
  const logGroupName = rawLogGroupName ? decodeURIComponent(rawLogGroupName) : null;
  const runtimeOrigin = normalizeRuntimeUrl(window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RUNTIME);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const logStreamsQuery = useQuery({
    queryKey: ["cloudwatch-log-streams", runtimeOrigin, logGroupName],
    queryFn: ({ signal }) => {
      if (!runtimeOrigin || !logGroupName) {
        throw new Error("Invalid runtime or log group name.");
      }
      return describeLogStreams(runtimeOrigin, logGroupName, signal);
    },
    enabled: runtimeOrigin !== null && logGroupName !== null,
  });

  const selectedStreamName = useMemo(() => searchParams.get("stream"), [searchParams]);

  useEffect(() => {
    if (!logStreamsQuery.data || logStreamsQuery.data.logStreams.length === 0) {
      return;
    }

    if (selectedStreamName) {
      return;
    }

    const firstStream = logStreamsQuery.data.logStreams[0]?.logStreamName;
    if (!firstStream) {
      return;
    }

    setSearchParams({ stream: firstStream }, { replace: true });
  }, [logStreamsQuery.data, selectedStreamName, setSearchParams]);

  const logEventsQuery = useQuery({
    queryKey: ["cloudwatch-log-events", runtimeOrigin, logGroupName, selectedStreamName],
    queryFn: ({ signal }) => {
      if (!runtimeOrigin || !logGroupName || !selectedStreamName) {
        throw new Error("Missing stream selection.");
      }
      return getLogEvents(runtimeOrigin, logGroupName, selectedStreamName, signal);
    },
    enabled: runtimeOrigin !== null && logGroupName !== null && selectedStreamName !== null,
  });

  const toggleExpanded = (rowKey: string): void => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground">
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <AppBreadcrumbs />

          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">CloudWatch Log Stream</CardTitle>
              <CardDescription>{logGroupName ? `Log Group: ${logGroupName}` : "Missing log group name."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                  Streams: {logStreamsQuery.data?.logStreams.length ?? 0}
                </Badge>
                <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                  Selected: {selectedStreamName ?? "--"}
                </Badge>
              </div>

              <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-300">Log Streams</div>
                  <div className="max-h-[520px] overflow-auto">
                    {runtimeOrigin === null || logGroupName === null ? (
                      <p className="px-4 py-4 text-sm text-slate-400">Invalid runtime URL or log group name.</p>
                    ) : logStreamsQuery.isLoading || !logStreamsQuery.data ? (
                      <p className="px-4 py-4 text-sm text-slate-400">Loading log streams...</p>
                    ) : logStreamsQuery.isError ? (
                      <p className="px-4 py-4 text-sm text-rose-300">Failed to load log streams.</p>
                    ) : logStreamsQuery.data.logStreams.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-slate-400">No log streams found.</p>
                    ) : (
                      <ul className="divide-y divide-slate-800">
                        {logStreamsQuery.data.logStreams.map((stream) => {
                          const isSelected = stream.logStreamName === selectedStreamName;
                          return (
                            <li key={stream.logStreamName}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSearchParams({ stream: stream.logStreamName }, { replace: true });
                                  setExpandedRows(new Set());
                                }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  isSelected ? "bg-sky-950/30 text-sky-200" : "text-slate-300 hover:bg-slate-900/70"
                                }`}
                              >
                                <div className="font-medium">{stream.logStreamName}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Last Ingestion:{" "}
                                  {stream.lastIngestionTime ? formatTimestamp(stream.lastIngestionTime) : "Unknown"}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/80">
                  <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-300">Log Events</div>
                  <div className="max-h-[520px] overflow-auto font-mono text-xs">
                    {!selectedStreamName ? (
                      <p className="px-4 py-4 text-slate-400">Select a log stream to view events.</p>
                    ) : logEventsQuery.isLoading ? (
                      <p className="px-4 py-4 text-slate-400">Loading log events...</p>
                    ) : logEventsQuery.isError ? (
                      <p className="px-4 py-4 text-rose-300">Failed to load log events.</p>
                    ) : !logEventsQuery.data || logEventsQuery.data.events.length === 0 ? (
                      <p className="px-4 py-4 text-slate-400">No log events found.</p>
                    ) : (
                      <ul className="divide-y divide-slate-800">
                        {logEventsQuery.data.events.map((event, index) => {
                          const rowKey = `${event.timestamp}-${index}`;
                          const isExpanded = expandedRows.has(rowKey);
                          const preview = createPreview(event.message);

                          return (
                            <li key={rowKey}>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(rowKey)}
                                className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                              >
                                <div className="mb-1 flex items-center gap-3 text-[11px] text-slate-500">
                                  <span>{isExpanded ? "▼" : "▶"}</span>
                                  <span>{formatTimestamp(event.timestamp)}</span>
                                </div>
                                {isExpanded ? (
                                  <pre className="whitespace-pre-wrap break-all text-slate-100">{event.message}</pre>
                                ) : (
                                  <p className="truncate text-slate-300">{preview}</p>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </ScrollArea>
  );
}
