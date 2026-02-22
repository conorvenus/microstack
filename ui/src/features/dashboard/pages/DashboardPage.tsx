import type { ReactElement } from "react";

import { AppBreadcrumbs } from "@/components/navigation/AppBreadcrumbs";
import { ScrollArea } from "@/components/ui/scroll-area";

import { RuntimeConnectionCard } from "../components/RuntimeConnectionCard";
import { ServiceGrid } from "../components/ServiceGrid";
import { useDashboardGrid } from "../hooks/useDashboardGrid";
import { useRuntimeHealth } from "../hooks/useRuntimeHealth";

export function DashboardPage(): ReactElement {
  const { inputValue, healthState, lastCheckedAt, setInputValue, commitRuntimeUrl } = useRuntimeHealth();
  const { visibleRows, scrollAreaRef, gridRef, firstCardRef, loadMoreRef, scrollViewportRef } = useDashboardGrid();

  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground"
    >
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <AppBreadcrumbs />

          <RuntimeConnectionCard
            inputValue={inputValue}
            onInputChange={setInputValue}
            onCommit={commitRuntimeUrl}
            healthState={healthState}
            lastCheckedAt={lastCheckedAt}
          />

          <ServiceGrid
            visibleRows={visibleRows}
            healthState={healthState}
            gridRef={gridRef}
            firstCardRef={firstCardRef}
            loadMoreRef={loadMoreRef}
            scrollViewportRef={scrollViewportRef}
          />
        </div>
      </main>
    </ScrollArea>
  );
}
