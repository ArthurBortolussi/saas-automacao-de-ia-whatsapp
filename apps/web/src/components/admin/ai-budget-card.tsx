import { AI_USAGE_SOURCE_LABEL, type AiBudgetView } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { DetailList } from "@/components/detail-list";
import { AI_USAGE_LEVEL_LABEL, formatUsd } from "@/lib/format";

/** Consumo do mês frente ao limite (somente SUPERADMIN). O simulado nunca aparece como custo real. */
export function AiBudgetCard({ budget }: { budget: AiBudgetView }) {
  const alert = budget.level === "NEAR_LIMIT" || budget.level === "LIMIT_REACHED";
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Limite mensal da IA</CardTitle>
          <Badge variant={alert ? "destructive" : "secondary"}>{AI_USAGE_LEVEL_LABEL[budget.level]}</Badge>
        </div>
      </CardHeader>
      <DetailList
        items={[
          { label: "Mês", value: `${budget.month} (${budget.timezone})` },
          { label: "Limite", value: budget.limitUsd ? formatUsd(budget.limitUsd) : "Sem limite" },
          { label: "Padrão da plataforma", value: budget.platformDefaultUsd ? formatUsd(budget.platformDefaultUsd) : "Não definido" },
          {
            label: "Gasto estimado (aplicado)",
            value: `${formatUsd(budget.spentUsd)}${budget.percent !== null ? ` · ${budget.percent}%` : ""} — ${AI_USAGE_SOURCE_LABEL[budget.enforcedSource]}`,
          },
          { label: "Reservado (em andamento)", value: formatUsd(budget.reservedUsd) },
          ...budget.bySource.map((row) => ({ label: AI_USAGE_SOURCE_LABEL[row.source], value: `${formatUsd(row.spentUsd)} · ${row.runs} execuções` })),
        ]}
      />
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        Estimativa pela tabela de preços (não é fatura). O bloqueio usa só a origem deste servidor; simulado e origem não verificada nunca
        se somam ao custo oficial.
      </p>
    </Card>
  );
}
