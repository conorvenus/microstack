import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReactElement } from "react";

export function ServiceCard(): ReactElement {
  return (
    <Card className="flex h-full flex-col border-slate-700 bg-slate-900/80">
      <CardHeader className="pb-4">
        <div className="mb-3 h-12 w-12 rounded-lg bg-slate-950/70 p-2">
          <img src="/assets/aws/lambda.svg" alt="AWS Lambda logo" className="h-full w-full object-contain" />
        </div>
        <CardTitle className="text-base text-slate-100">AWS Lambda</CardTitle>
        <CardDescription>Function runtime emulation</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Badge className="bg-emerald-500/20 text-emerald-300">Available</Badge>
      </CardContent>
    </Card>
  );
}
