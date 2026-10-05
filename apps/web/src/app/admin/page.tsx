import type { AdminAlertsResponse, AdminDashboardResponse } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { ArrowRight, Building2, CheckCircle2, Plus, Rocket, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AiLimitAlerts } from "@/components/admin/ai-limit-alerts";
import { StatCard } from "@/components/analytics/stat-card";
import { CompaniesTable } from "@/components/companies-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { fetchPageData } from "@/lib/api-server";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [data, alerts] = await Promise.all([
    fetchPageData<AdminDashboardResponse>("/admin/dashboard"),
    fetchPageData<AdminAlertsResponse>("/admin/alerts"),
  ]);
  return (
    <>
      <PageHeader
        title="Dashboard da plataforma"
        description="Visão geral de todas as empresas atendidas pela Vortrix AI."
        actions={
          <Button asChild>
            <Link href="/admin/companies/new">
              <Plus /> Nova empresa
            </Link>
          </Button>
        }
      />
      <section aria-label="Totais da plataforma" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Empresas" value={formatNumber(data.totals.companies)} hint="Cadastradas na plataforma" icon={<Building2 />} href="/admin/companies" />
        <StatCard label="Empresas ativas" value={formatNumber(data.totals.activeCompanies)} hint="Com acesso liberado" icon={<CheckCircle2 />} />
        <StatCard label="Em onboarding" value={formatNumber(data.totals.onboardingCompanies)} hint="Em configuração inicial" icon={<Rocket />} />
        <StatCard label="Usuários" value={formatNumber(data.totals.users)} hint="Em todas as empresas" icon={<Users />} href="/admin/users" />
      </section>
      {alerts.aiLimitAlerts.length > 0 || alerts.suspendedCompanies > 0 ? (
        <SectionCard
          title="Alertas"
          description={
            alerts.suspendedCompanies > 0
              ? `${alerts.suspendedCompanies === 1 ? "1 empresa suspensa" : `${alerts.suspendedCompanies} empresas suspensas`}.`
              : "Consumo da IA perto ou acima do limite mensal."
          }
          className="mt-6 border-warning/40"
          contentClassName="p-0"
        >
          <AiLimitAlerts rows={alerts.aiLimitAlerts} />
        </SectionCard>
      ) : null}
      <SectionCard
        title="Empresas recentes"
        className="mt-6"
        contentClassName="p-0"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/companies">
              Ver todas <ArrowRight />
            </Link>
          </Button>
        }
      >
        <CompaniesTable companies={data.recentCompanies} />
      </SectionCard>
    </>
  );
}
