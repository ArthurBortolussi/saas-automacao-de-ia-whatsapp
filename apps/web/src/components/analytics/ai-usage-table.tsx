import { AI_USAGE_SOURCE_LABEL, type AiUsageBucket } from "@arthur-ai/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { formatNumber, formatUsd } from "@/lib/format";

/**
 * Consumo da IA separado por origem. Só a linha "API oficial" é estimativa de despesa real; simulador e registros
 * antigos (origem não verificada) aparecem à parte e nunca entram no custo oficial.
 */
export function AiUsageTable({ buckets }: { buckets: AiUsageBucket[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Origem</TableHead>
          <TableHead className="text-right">Execuções</TableHead>
          <TableHead className="text-right">Tokens entrada / saída</TableHead>
          <TableHead className="text-right">Cache escrita / leitura</TableHead>
          <TableHead className="text-right">Custo estimado</TableHead>
          <TableHead className="pr-5 text-right">Média por atendimento</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((bucket) => (
          <TableRow key={bucket.source} className={bucket.source === "OFFICIAL" ? "" : "text-muted-foreground"}>
            <TableCell className="pl-5">
              {AI_USAGE_SOURCE_LABEL[bucket.source]}
              {bucket.runsWithoutCost > 0 ? (
                <span className="block text-xs text-muted-foreground">{formatNumber(bucket.runsWithoutCost)} execução(ões) sem custo estimado</span>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(bucket.runs)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(bucket.inputTokens)} / {formatNumber(bucket.outputTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(bucket.cacheCreationInputTokens)} / {formatNumber(bucket.cacheReadInputTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(bucket.estimatedCostUsd)}</TableCell>
            <TableCell className="pr-5 text-right tabular-nums">
              {bucket.averageCostPerCycleUsd ? formatUsd(bucket.averageCostPerCycleUsd) : <span className="text-muted-foreground">Indisponível</span>}
              {bucket.cyclesWithCost > 0 ? <span className="block text-xs text-muted-foreground">{formatNumber(bucket.cyclesWithCost)} atendimento(s)</span> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Aviso quando há consumo que não é da API oficial no período. */
export function UsageOriginNotice({ buckets }: { buckets: AiUsageBucket[] }) {
  const simulated = buckets.find((bucket) => bucket.source === "SIMULATED")?.runs ?? 0;
  const unverified = buckets.find((bucket) => bucket.source === "UNVERIFIED")?.runs ?? 0;
  if (simulated === 0 && unverified === 0) return null;
  return (
    <p className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-foreground/80">
      {simulated > 0 ? `${formatNumber(simulated)} execução(ões) foram feitas no simulador: os valores não são despesa real. ` : ""}
      {unverified > 0 ? `${formatNumber(unverified)} execução(ões) são anteriores ao registro de origem: tratadas como origem não verificada.` : ""}
    </p>
  );
}
