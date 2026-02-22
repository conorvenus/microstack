import type { ReactElement } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RuntimeConnectionCard,
  ServiceGrid,
  useDashboardGrid,
  useRuntimeHealth,
} from "@/features/dashboard";

function App(): ReactElement {
  const { inputValue, healthState, lastCheckedAt, setInputValue, commitRuntimeUrl } = useRuntimeHealth();
  const { visibleRows, scrollAreaRef, gridRef, firstCardRef, loadMoreRef, scrollViewportRef } = useDashboardGrid();

  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="h-screen w-full bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-foreground"
    >
      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <RuntimeConnectionCard
            inputValue={inputValue}
            onInputChange={setInputValue}
            onCommit={commitRuntimeUrl}
            healthState={healthState}
            lastCheckedAt={lastCheckedAt}
          />

          <ServiceGrid
            visibleRows={visibleRows}
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

export default App;
