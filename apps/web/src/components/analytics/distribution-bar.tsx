import { sharePercent, type CycleBreakdown } from "@arthur-ai/shared";
import { formatNumber } from "@/lib/format";
import { SERIES } from "./chart-colors";

/** Participação da IA e da equipe nos atendimentos iniciados no período (barra 100% + legenda com números). */
export function DistributionBar({ cycles }: { cycles: CycleBreakdown }) {
  const parts = [
    { key: "aiOnly", value: cycles.aiOnlyClosed + cycles.aiOnlyOpen, ...SERIES.aiOnly },
    { key: "withHuman", value: cycles.withHuman, ...SERIES.withHuman },
    { key: "awaitingHuman", value: cycles.awaitingHuman, ...SERIES.awaitingHuman },
    { key: "other", value: cycles.withoutResponse, ...SERIES.other },
  ];
  const total = cycles.started;
  if (total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum atendimento iniciado no período.</p>;
  return (
    <div className="space-y-4">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="Distribuição dos atendimentos do período">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <div
              key={part.key}
              className="h-full first:rounded-l last:rounded-r"
              style={{ width: `${(part.value / total) * 100}%`, backgroundColor: part.color }}
              title={`${part.label}: ${formatNumber(part.value)} (${sharePercent(part.value, total) ?? 0}%)`}
            />
          ))}
      </div>
      <ul className="grid gap-2 text-sm">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: part.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatNumber(part.value)} <span className="text-xs text-muted-foreground">({sharePercent(part.value, total) ?? 0}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
