import { AI_RUN_RESULTS, AI_USAGE_SOURCE_LABEL, type AiUsageSummary } from "@arthur-ai/shared";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import Link from "next/link";
import { AiUsageTable, UsageOriginNotice } from "@/components/analytics/ai-usage-table";
import { PeriodNote } from "@/components/analytics/operational-view";
import { parsePeriod, PeriodTabs } from "@/components/analytics/period-tabs";
import { fetchPageData } from "@/lib/api-server";
import { AI_HANDOFF_REASON_LABEL, AI_RUN_RESULT_LABEL, formatDateTime, formatNumber, formatUsd } from "@/lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export default async function CompanyUsagePage({ params, searchParams }: PageProps<"/admin/companies/[companyId]/usage">) {
  const { companyId } = await params;
  const period = parsePeriod((await searchParams)["period"]);
  const id = encodeURIComponent(companyId);
  // Fase 6: mesmo período e fuso do Analytics da plataforma (os números batem com o resumo por empresa).
  const usage = await fetchPageData<AiUsageSummary>(`/admin/companies/${id}/ai/usage?period=${period}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Consumo da IA desta empresa (estimativa em USD).</p>
          <PeriodNote period={usage.period} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodTabs current={period} hrefFor={(value) => `/admin/companies/${id}/usage?period=${value}`} />
          <Link href={`/admin/analytics?period=${period}&company=${id}`} className="text-xs text-muted-foreground hover:underline">
            Ver no Analytics
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Execuções da IA"
          value={formatNumber(usage.runs)}
          hint={AI_RUN_RESULTS.map((result) => `${AI_RUN_RESULT_LABEL[result]}: ${usage.byResult[result]}`).join(" · ")}
        />
        <Stat label="Custo estimado (todas as origens)" value={formatUsd(usage.estimatedCostUsd)} hint="Veja abaixo quanto é da API oficial; simulado não é custo real." />
        <Stat label="Tokens de entrada / saída" value={`${formatNumber(usage.inputTokens)} / ${formatNumber(usage.outputTokens)}`} />
        <Stat
          label="Tokens de cache (escrita / leitura)"
          value={`${formatNumber(usage.cacheCreationInputTokens)} / ${formatNumber(usage.cacheReadInputTokens)}`}
          hint="Leitura de cache custa uma fração da entrada normal (veja os preços abaixo)."
        />
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">Por origem</CardTitle>
        </CardHeader>
        <AiUsageTable buckets={usage.bySource} />
        <div className="border-t px-5 py-3">
          <UsageOriginNotice buckets={usage.bySource} />
        </div>
      </Card>

      {usage.runsWithoutUsage > 0 || usage.runsWithoutPrice > 0 ? (
        <p className="text-sm text-muted-foreground">
          {usage.runsWithoutUsage > 0 ? `${usage.runsWithoutUsage} execução(ões) sem consumo informado pela API (erros antes da resposta). ` : ""}
          {usage.runsWithoutPrice > 0 ? `${usage.runsWithoutPrice} execução(ões) de modelo sem preço configurado: custo fora da soma.` : ""}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Por dia</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Dia</TableHead>
                <TableHead className="text-right">Execuções</TableHead>
                <TableHead className="pr-5 text-right">Custo estimado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.daily.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="px-5 text-muted-foreground">
                    Nenhuma execução no período.
                  </TableCell>
                </TableRow>
              ) : (
                usage.daily.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="pl-5">{day.date.split("-").reverse().join("/")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(day.runs)}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{formatUsd(day.estimatedCostUsd)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Por modelo</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Modelo</TableHead>
                <TableHead className="text-right">Execuções</TableHead>
                <TableHead className="pr-5 text-right">Custo estimado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.byModel.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="pl-5 font-mono text-xs">{row.model}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.runs)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{formatUsd(row.estimatedCostUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            {usage.pricing
              ? `Preço usado para ${usage.pricing.model} (US$ por milhão de tokens): entrada ${usage.pricing.inputPerMTok}, saída ${usage.pricing.outputPerMTok}, escrita de cache ${usage.pricing.cacheWritePerMTok}, leitura de cache ${usage.pricing.cacheReadPerMTok}.`
              : "Sem preço configurado para o modelo atual: o custo não é estimado (veja AI_PRICE_* no README)."}
          </p>
        </Card>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">Execuções recentes</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Quando</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead className="text-right">Msgs</TableHead>
              <TableHead className="text-right">Entrada</TableHead>
              <TableHead className="text-right">Saída</TableHead>
              <TableHead className="text-right">Cache (leitura)</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="pr-5 text-right">Tempo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.recent.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="px-5 text-muted-foreground">
                  Nenhuma execução no período.
                </TableCell>
              </TableRow>
            ) : (
              usage.recent.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="pl-5 whitespace-nowrap">{formatDateTime(run.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{AI_USAGE_SOURCE_LABEL[run.apiSource]}</TableCell>
                  <TableCell>
                    {AI_RUN_RESULT_LABEL[run.result]}
                    {run.handoffReason ? <span className="block text-xs text-muted-foreground">{AI_HANDOFF_REASON_LABEL[run.handoffReason]}</span> : null}
                    {run.errorType ? <span className="block text-xs text-destructive">{run.errorType}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{run.messageCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(run.inputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(run.outputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(run.cacheReadInputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(run.costUsd)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{run.latencyMs === null ? "—" : `${(run.latencyMs / 1000).toFixed(1)} s`}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
