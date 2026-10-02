import type { CompanyAnalyticsReport } from "@arthur-ai/shared";
import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import type { Metadata } from "next";
import { ExportButtons } from "@/components/analytics/export-buttons";
import { OperationalView, PeriodNote } from "@/components/analytics/operational-view";
import { parsePeriod, PeriodTabs } from "@/components/analytics/period-tabs";
import { PageHeader } from "@/components/page-header";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analytics">) {
  const { me, companyId } = await requireMembership();
  // Só conveniência: a API recusa (403) o relatório e as exportações para quem não é proprietário ou administrador.
  if (me.membership?.role === "AGENT") {
    return (
      <>
        <PageHeader title="Analytics" />
        <Alert className="max-w-xl">
          <AlertTitle>Acesso restrito</AlertTitle>
          <AlertDescription>Os relatórios de atendimento estão disponíveis apenas para o proprietário e os administradores da empresa.</AlertDescription>
        </Alert>
      </>
    );
  }
  const period = parsePeriod((await searchParams)["period"]);
  const report = await fetchPageData<CompanyAnalyticsReport>(`/companies/${companyId}/analytics?period=${period}`);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Como estão os atendimentos da sua empresa: volume, participação da IA e da equipe, e tempos de resposta."
        actions={<ExportButtons basePath={`/companies/${companyId}/analytics`} period={period} at={report.generatedAt} />}
      />
      <div className="mb-6 space-y-2">
        <PeriodTabs current={period} hrefFor={(value) => `/dashboard/analytics?period=${value}`} />
        <PeriodNote period={report.period} />
      </div>
      <OperationalView data={report} />
    </>
  );
}
