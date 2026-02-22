import { Activity, Globe } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DEFAULT_RUNTIME = "http://127.0.0.1:1337";
const STORAGE_KEY = "microstack.runtimeUrl";
const POLL_INTERVAL_MS = 5000;
const HEALTH_PATH = "/microstack/health";
const REQUEST_TIMEOUT_MS = 3000;
const INITIAL_ROWS = 1;
const CARDS_PER_ROW = 4;
const ROW_BATCH_SIZE = 2;

type HealthState = "healthy" | "unreachable" | "invalid";

function normalizeRuntimeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function formatStatus(state: HealthState): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "unreachable":
      return "Unreachable";
    case "invalid":
      return "Invalid URL";
  }
  return "Unreachable";
}

function App(): React.ReactElement {
  const [inputValue, setInputValue] = useState<string>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ?? DEFAULT_RUNTIME;
  });
  const [runtimeOrigin, setRuntimeOrigin] = useState<string | null>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RUNTIME;
    return normalizeRuntimeUrl(saved) ?? DEFAULT_RUNTIME;
  });
  const [healthState, setHealthState] = useState<HealthState>("unreachable");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [visibleRows, setVisibleRows] = useState<number>(INITIAL_ROWS);
  const [scrollViewportEl, setScrollViewportEl] = useState<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLElement | null>(null);

  const totalCards = visibleRows * CARDS_PER_ROW;
  const cardIndexes = useMemo(() => Array.from({ length: totalCards }, (_, index) => index), [totalCards]);

  const commitRuntimeUrl = useCallback(() => {
    const normalized = normalizeRuntimeUrl(inputValue);
    if (!normalized) {
      setRuntimeOrigin(null);
      setHealthState("invalid");
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    setInputValue(normalized);
    setRuntimeOrigin(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }, [inputValue]);

  useEffect(() => {
    if (!runtimeOrigin) {
      setHealthState("invalid");
      return;
    }

    let cancelled = false;

    const check = async (): Promise<void> => {
      if (!runtimeOrigin) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${runtimeOrigin}${HEALTH_PATH}`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Health endpoint returned non-OK");
        }

        const payload = (await response.json()) as { status?: string };
        if (!cancelled) {
          setHealthState(payload.status === "ok" ? "healthy" : "unreachable");
          setLastCheckedAt(new Date());
        }
      } catch {
        if (!cancelled) {
          setHealthState("unreachable");
          setLastCheckedAt(new Date());
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    void check();
    const intervalId = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [runtimeOrigin]);

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) {
      return;
    }

    const viewport = root.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    scrollViewportRef.current = viewport;
    setScrollViewportEl(viewport);
  }, []);

  useEffect(() => {
    const measureAndFillViewport = (): void => {
      const grid = gridRef.current;
      const firstCard = firstCardRef.current;
      if (!grid || !firstCard) {
        return;
      }

      const cardRect = firstCard.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const rowGap = Number.parseFloat(window.getComputedStyle(grid).rowGap || "0") || 0;
      const cardHeight = cardRect.height;

      if (cardHeight <= 0) {
        return;
      }

      const viewportBottom = scrollViewportEl ? scrollViewportEl.getBoundingClientRect().bottom : window.innerHeight;
      const viewportCapacity = Math.max(viewportBottom - gridRect.top, cardHeight);
      const rowFootprint = cardHeight + rowGap;
      const requiredRows = Math.max(1, Math.ceil((viewportCapacity + rowGap) / rowFootprint));
      setVisibleRows((current) => Math.max(current, requiredRows));
    };

    let rafId = 0;
    const scheduleMeasure = (): void => {
      cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(measureAndFillViewport);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });

    if (gridRef.current) {
      resizeObserver.observe(gridRef.current);
    }
    if (firstCardRef.current) {
      resizeObserver.observe(firstCardRef.current);
    }
    if (scrollViewportEl) {
      resizeObserver.observe(scrollViewportEl);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver.disconnect();
    };
  }, [scrollViewportEl]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !scrollViewportEl) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting);
        if (!isVisible) {
          return;
        }
        setVisibleRows((current) => current + ROW_BATCH_SIZE);
      },
      { root: scrollViewportEl, rootMargin: "450px 0px 450px 0px" },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [scrollViewportEl, visibleRows]);

  const statusDotClassName =
    healthState === "healthy" ? "bg-emerald-400" : "bg-rose-400";

  return (
    <ScrollArea ref={scrollAreaRef} className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground">
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-slate-100">Runtime Connection</CardTitle>
              <CardDescription>Configure the runtime endpoint for health checks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <Input
                  value={inputValue}
                  onChange={(event) => {
                    setInputValue(event.target.value);
                  }}
                  onBlur={commitRuntimeUrl}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitRuntimeUrl();
                    }
                  }}
                  className="h-11 border-slate-700/80 bg-slate-950/80 pl-10 text-slate-100 placeholder:text-slate-500"
                  placeholder="127.0.0.1:1337"
                  aria-label="Microstack runtime URL"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                <span className={cn("h-2.5 w-2.5 rounded-full", statusDotClassName)} aria-hidden="true" />
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-slate-400" />
                  {formatStatus(healthState)}
                </span>
                <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                  Last Checked: {lastCheckedAt ? lastCheckedAt.toLocaleTimeString() : "--"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <section ref={gridRef} className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cardIndexes.map((cardIndex) => {
              const rowIndex = Math.floor(cardIndex / CARDS_PER_ROW);
              const columnIndex = cardIndex % CARDS_PER_ROW;
              const initialDelay = rowIndex * 0.03 + columnIndex * 0.05;

              return (
                <motion.div
                  key={cardIndex}
                  ref={cardIndex === 0 ? firstCardRef : undefined}
                  className="h-full"
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2, root: scrollViewportRef }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: initialDelay }}
                >
                  {cardIndex === 0 ? (
                    <Card className="flex h-full flex-col border-slate-700 bg-slate-900/80">
                      <CardHeader className="pb-4">
                        <div className="mb-3 h-12 w-12 rounded-lg bg-slate-950/70 p-2">
                          <img
                            src="/assets/aws/lambda.svg"
                            alt="AWS Lambda logo"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <CardTitle className="text-base text-slate-100">AWS Lambda</CardTitle>
                        <CardDescription>Function runtime emulation</CardDescription>
                      </CardHeader>
                      <CardContent className="mt-auto">
                        <Badge className="bg-emerald-500/20 text-emerald-300">Available</Badge>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="flex h-full flex-col border-slate-800 bg-slate-900/60">
                      <CardHeader className="space-y-3 pb-4">
                        <Skeleton className="h-10 w-10 rounded-lg bg-slate-800" />
                        <Skeleton className="h-4 w-24 bg-slate-800" />
                        <Skeleton className="h-3 w-20 bg-slate-800" />
                      </CardHeader>
                      <CardContent className="mt-auto">
                        <Skeleton className="h-5 w-16 rounded-full bg-slate-800" />
                      </CardContent>
                    </Card>
                  )}
                </motion.div>
              );
            })}
          </section>
          <div ref={loadMoreRef} className="h-2 w-full" aria-hidden="true" />
        </div>
      </main>
    </ScrollArea>
  );
}

export default App;
