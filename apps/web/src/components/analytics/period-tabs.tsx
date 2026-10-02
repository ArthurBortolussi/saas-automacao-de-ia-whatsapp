import { ANALYTICS_PERIOD_LABEL, ANALYTICS_PERIODS, type AnalyticsPeriod } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import Link from "next/link";

/** Seletor único de período: vale para todos os cards, gráficos e exportações da página. */
export function PeriodTabs({ current, hrefFor }: { current: AnalyticsPeriod; hrefFor: (period: AnalyticsPeriod) => string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
      {ANALYTICS_PERIODS.map((period) => (
        <Button key={period} asChild size="sm" variant={period === current ? "default" : "outline"}>
          <Link href={hrefFor(period)} prefetch={false} aria-current={period === current ? "true" : undefined}>
            {ANALYTICS_PERIOD_LABEL[period]}
          </Link>
        </Button>
      ))}
    </div>
  );
}

export function parsePeriod(value: string | string[] | undefined): AnalyticsPeriod {
  return typeof value === "string" && (ANALYTICS_PERIODS as readonly string[]).includes(value) ? (value as AnalyticsPeriod) : "last7days";
}
