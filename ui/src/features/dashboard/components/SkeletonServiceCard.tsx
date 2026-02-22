import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactElement } from "react";

export function SkeletonServiceCard(): ReactElement {
  return (
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
  );
}
