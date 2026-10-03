import type { AdminAlertsResponse, AdminDashboardResponse } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { AiLimitAlerts } from "@/components/admin/ai-limit-alerts";
import { CompaniesTable } from "@/components/companies-table";
import { PageHeader } from "@/components/page-header";
import { fetchPageData } from "@/lib/api-server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [data, alerts] = await Promise.all([
    fetchPageData<AdminDashboardResponse>("/admin/dashboard"),
    fetchPageData<AdminAlertsResponse>("/admin/alerts"),
  ]);
  const stats = [
    { label: "Empresas", value: data.totals.companies },
    { label: "Empresas ativas", value: data.totals.activeCompanies },
    { label: "Em onboarding", value: data.totals.onboardingCompanies },
    { label: "Usuários", value: data.totals.users },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral da plataforma."
        actions={
          <Button asChild>
            <Link href="/admin/companies/new">Nova empresa</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{stat.label}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {alerts.aiLimitAlerts.length > 0 || alerts.suspendedCompanies > 0 ? (
        <Card className="mt-8 gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Alertas</CardTitle>
            {alerts.suspendedCompanies > 0 ? (
              <CardDescription>
                {alerts.suspendedCompanies === 1 ? "1 empresa suspensa" : `${alerts.suspendedCompanies} empresas suspensas`}.
              </CardDescription>
            ) : null}
          </CardHeader>
          <AiLimitAlerts rows={alerts.aiLimitAlerts} />
        </Card>
      ) : null}
      <Card className="mt-8 gap-0 py-0">
        <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">Empresas recentes</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/companies">Ver todas</Link>
          </Button>
        </CardHeader>
        <CompaniesTable companies={data.recentCompanies} />
      </Card>
    </>
  );
}
