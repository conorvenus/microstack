import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import type { HealthState } from "../types";

type ServiceCardProps = {
  title: string;
  description: string;
  iconSrc: string;
  iconAlt: string;
  href: string;
  ariaLabel: string;
  healthState: HealthState;
};

export function ServiceCard({
  title,
  description,
  iconSrc,
  iconAlt,
  href,
  ariaLabel,
  healthState,
}: ServiceCardProps): ReactElement {
  const availabilityLabel =
    healthState === "invalid" ? "Disabled" : healthState === "healthy" ? "Available" : "Unavailable";
  const availabilityClassName =
    healthState === "invalid"
      ? "bg-slate-500/20 text-slate-300"
      : healthState === "healthy"
        ? "bg-emerald-500/20 text-emerald-300"
        : "bg-rose-500/20 text-rose-300";

  return (
    <Link
      to={href}
      aria-label={ariaLabel}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <Card
        className={cn(
          "flex h-full flex-col border-slate-700 bg-slate-900/80 transition-colors hover:border-slate-500",
          healthState === "invalid" ? "opacity-75" : undefined,
        )}
      >
        <CardHeader className="pb-4">
          <div className="mb-3 h-12 w-12 rounded-lg bg-slate-950/70 p-2">
            <img src={iconSrc} alt={iconAlt} className="h-full w-full object-contain" />
          </div>
          <CardTitle className="text-base text-slate-100">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="mt-auto">
          <Badge className={availabilityClassName}>{availabilityLabel}</Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
