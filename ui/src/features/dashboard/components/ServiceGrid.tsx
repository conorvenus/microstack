import { motion } from "framer-motion";
import { useMemo, type MutableRefObject, type ReactElement } from "react";

import { CARDS_PER_ROW } from "../constants";
import { ServiceCard } from "./ServiceCard";
import { SkeletonServiceCard } from "./SkeletonServiceCard";

type ServiceGridProps = {
  visibleRows: number;
  gridRef: MutableRefObject<HTMLElement | null>;
  firstCardRef: MutableRefObject<HTMLDivElement | null>;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  scrollViewportRef: MutableRefObject<HTMLElement | null>;
};

export function ServiceGrid({
  visibleRows,
  gridRef,
  firstCardRef,
  loadMoreRef,
  scrollViewportRef,
}: ServiceGridProps): ReactElement {
  const totalCards = visibleRows * CARDS_PER_ROW;
  const cardIndexes = useMemo(() => Array.from({ length: totalCards }, (_, index) => index), [totalCards]);

  return (
    <>
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
              {cardIndex === 0 ? <ServiceCard /> : <SkeletonServiceCard />}
            </motion.div>
          );
        })}
      </section>
      <div ref={loadMoreRef} className="h-2 w-full" aria-hidden="true" />
    </>
  );
}
