import { Activity, Globe } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { HealthState } from "../types";
import { formatStatus } from "../utils";

type RuntimeConnectionCardProps = {
  inputValue: string;
  onInputChange: (next: string) => void;
  onCommit: () => void;
  healthState: HealthState;
  lastCheckedAt: Date | null;
};

export function RuntimeConnectionCard({
  inputValue,
  onInputChange,
  onCommit,
  healthState,
  lastCheckedAt,
}: RuntimeConnectionCardProps): ReactElement {
  const statusDotClassName = healthState === "healthy" ? "bg-emerald-400" : "bg-rose-400";

  return (
    <Card className="border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-slate-100">Runtime Connection</CardTitle>
        <CardDescription>Configure the runtime endpoint used across MicroStack services and management views.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <Input
            value={inputValue}
            onChange={(event) => {
              onInputChange(event.target.value);
            }}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCommit();
              }
            }}
            className="h-11 border-slate-700/80 bg-slate-950/80 pl-10 text-slate-100 placeholder:text-slate-500"
            placeholder="127.0.0.1:1337"
            aria-label="MicroStack runtime URL"
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
  );
}
