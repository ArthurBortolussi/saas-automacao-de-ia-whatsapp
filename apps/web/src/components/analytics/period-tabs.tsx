import { ANALYTICS_PERIOD_LABEL, ANALYTICS_PERIODS, type AnalyticsPeriod } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import Link from "next/link";

/** Seletor único de período (controle segmentado): vale para todos os cards, gráficos e exportações da página. */
export function PeriodTabs({ current, hrefFor }: { current: AnalyticsPeriod; hrefFor: (period: AnalyticsPeriod) => string }) {
  return (
    <div className="inline-flex w-fit rounded-lg border bg-card p-1 shadow-card" role="group" aria-label="Período">
      {ANALYTICS_PERIODS.map((period) => (
        <Link
          key={period}
          href={hrefFor(period)}
          prefetch={false}
          aria-current={period === current ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            period === current ? "bg-brand-soft font-medium text-brand-strong" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {ANALYTICS_PERIOD_LABEL[period]}
        </Link>
      ))}
    </div>
  );
}

export function parsePeriod(value: string | string[] | undefined): AnalyticsPeriod {
  return typeof value === "string" && (ANALYTICS_PERIODS as readonly string[]).includes(value) ? (value as AnalyticsPeriod) : "last7days";
}
