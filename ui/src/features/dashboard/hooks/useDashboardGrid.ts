import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { INITIAL_ROWS, ROW_BATCH_SIZE } from "../constants";

type DashboardGridState = {
  visibleRows: number;
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>;
  gridRef: MutableRefObject<HTMLElement | null>;
  firstCardRef: MutableRefObject<HTMLDivElement | null>;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  scrollViewportRef: MutableRefObject<HTMLElement | null>;
};

export function useDashboardGrid(): DashboardGridState {
  const [visibleRows, setVisibleRows] = useState<number>(INITIAL_ROWS);
  const [scrollViewportEl, setScrollViewportEl] = useState<HTMLElement | null>(null);

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLElement | null>(null);

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

  return {
    visibleRows,
    scrollAreaRef,
    gridRef,
    firstCardRef,
    loadMoreRef,
    scrollViewportRef,
  };
}
