import type { AdminCompanyAnalytics, MessageVolume, PlatformAnalyticsReport } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { AiUsageTable, UsageOriginNotice } from "@/components/analytics/ai-usage-table";
import { ExportButtons } from "@/components/analytics/export-buttons";
import { OperationalView, PeriodNote } from "@/components/analytics/operational-view";
import { parsePeriod, PeriodTabs } from "@/components/analytics/period-tabs";
import { StatCard } from "@/components/analytics/stat-card";
import { PageHeader } from "@/components/page-header";
import { fetchPageData } from "@/lib/api-server";
import { COMPANY_STATUS_LABEL, formatNumber, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessageCards({ messages }: { messages: MessageVolume }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Mensagens recebidas" value={formatNumber(messages.inbound)} />
      <StatCard label="Enviadas pela IA" value={formatNumber(messages.outboundAi)} />
      <StatCard label="Enviadas pela equipe" value={formatNumber(messages.outboundAgent)} />
      <StatCard
        label="Avisos automáticos"
        value={formatNumber(messages.outboundSystem)}
        hint={messages.outboundFailed ? `${formatNumber(messages.outboundFailed)} envio(s) com falha no período` : "Nenhum envio com falha"}
      />
    </div>
  );
}

function UsageCard({ buckets, title }: { buckets: AdminCompanyAnalytics["ai"]["bySource"]; title: string }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Estimativa em dólares (USD) pela tabela de preços de cada execução. Não é o custo operacional completo da plataforma; a fatura oficial é a
          da Anthropic.
        </CardDescription>
      </CardHeader>
      <AiUsageTable buckets={buckets} />
      <div className="border-t px-5 py-3">
        <UsageOriginNotice buckets={buckets} />
      </div>
    </Card>
  );
}

export default async function AdminAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  const params = await searchParams;
  const period = parsePeriod(params["period"]);
  const companyParam = typeof params["company"] === "string" && UUID.test(params["company"]) ? params["company"] : null;
  const [platform, selected] = await Promise.all([
    fetchPageData<PlatformAnalyticsReport>(`/admin/analytics?period=${period}`),
    companyParam ? fetchPageData<AdminCompanyAnalytics>(`/admin/analytics/companies/${companyParam}?period=${period}`) : Promise.resolve(null),
  ]);
  const href = (next: { period?: string; company?: string | null }) => {
    const query = new URLSearchParams({ period: next.period ?? period });
    const company = next.company === undefined ? companyParam : next.company;
    if (company) query.set("company", company);
    return `/admin/analytics?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Indicadores consolidados da plataforma, consumo da IA e custos estimados por empresa."
        actions={<ExportButtons basePath="/admin/analytics" period={period} at={platform.generatedAt} />}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <PeriodTabs current={period} hrefFor={(value) => href({ period: value })} />
          <PeriodNote period={platform.period} />
        </div>
        <form action="/admin/analytics" className="flex items-center gap-2">
          <input type="hidden" name="period" value={period} />
          <label htmlFor="company" className="text-sm text-muted-foreground">
            Empresa
          </label>
          <NativeSelect id="company" name="company" size="sm" defaultValue={companyParam ?? ""}>
            <NativeSelectOption value="">Toda a plataforma</NativeSelectOption>
            {platform.byCompany.map((row) => (
              <NativeSelectOption key={row.companyId} value={row.companyId}>
                {row.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="outline">
            Ver
          </Button>
        </form>
      </div>

      {selected ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {selected.company.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">({COMPANY_STATUS_LABEL[selected.company.status]})</span>
            </h2>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/companies/${selected.company.id}/usage?period=${period}`}>Execuções da IA</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={href({ company: null })}>Voltar para toda a plataforma</Link>
              </Button>
            </div>
          </div>
          <OperationalView data={selected} />
          <MessageCards messages={selected.messages} />
          <UsageCard buckets={selected.ai.bySource} title="Consumo da IA desta empresa" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Empresas cadastradas" value={formatNumber(platform.companies.total)} />
            <StatCard label="Empresas com atividade" value={formatNumber(platform.companies.withActivity)} hint="Atendimento iniciado ou mensagem no período" />
          </div>
          <OperationalView data={platform} />
          <MessageCards messages={platform.messages} />
          <UsageCard buckets={platform.ai.bySource} title="Consumo da IA na plataforma" />

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
              <CardTitle className="text-base">Resumo por empresa</CardTitle>
              <CardDescription>Ordenado pelo custo estimado oficial. Custos simulados ou de origem não verificada ficam em coluna separada.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Empresa</TableHead>
                  <TableHead className="text-right">Atendimentos</TableHead>
                  <TableHead className="text-right">Execuções da IA</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Custo oficial</TableHead>
                  <TableHead className="pr-5 text-right">Simulado / não verificado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platform.byCompany.map((row) => (
                  <TableRow key={row.companyId}>
                    <TableCell className="pl-5">
                      <Link href={href({ company: row.companyId })} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{COMPANY_STATUS_LABEL[row.status]}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.cyclesStarted)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.aiRuns)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.totalTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(row.costOfficialUsd)}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums text-muted-foreground">{formatUsd(row.costNotOfficialUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
