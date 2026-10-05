import type { AdminPlatformSettingsResponse } from "@arthur-ai/shared";
import type { Metadata } from "next";
import { AiLimitAlerts } from "@/components/admin/ai-limit-alerts";
import { IntegrationsStatusCards } from "@/components/admin/integrations-status";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { fetchPageData } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações" };

export default async function AdminSettingsPage() {
  const data = await fetchPageData<AdminPlatformSettingsResponse>("/admin/platform-settings");
  return (
    <>
      <PageHeader title="Configurações" description="Suporte, limite padrão da IA e estado das integrações da plataforma." />
      <div className="space-y-6">
        <SectionCard title="Plataforma" description="Somente o Superadmin altera. Nenhuma credencial é exibida nesta página.">
          <PlatformSettingsForm settings={data.settings} />
        </SectionCard>
        <div>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Integrações</h2>
          <IntegrationsStatusCards status={data.integrations} />
        </div>
        <SectionCard title="Consumo da IA perto do limite" contentClassName="p-0">
          <AiLimitAlerts rows={data.aiLimitAlerts} />
        </SectionCard>
      </div>
    </>
  );
}
