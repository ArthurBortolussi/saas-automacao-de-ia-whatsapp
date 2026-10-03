import type { AdminPlatformSettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { AiLimitAlerts } from "@/components/admin/ai-limit-alerts";
import { IntegrationsStatusCards } from "@/components/admin/integrations-status";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { PageHeader } from "@/components/page-header";
import { fetchPageData } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações" };

export default async function AdminSettingsPage() {
  const data = await fetchPageData<AdminPlatformSettingsResponse>("/admin/platform-settings");
  return (
    <>
      <PageHeader title="Configurações" description="Suporte, limite padrão da IA e estado das integrações da plataforma." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plataforma</CardTitle>
            <CardDescription>Somente o Superadmin altera. Nenhuma credencial é exibida nesta página.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlatformSettingsForm settings={data.settings} />
          </CardContent>
        </Card>
        <div>
          <h2 className="mb-4 text-base font-semibold">Integrações</h2>
          <IntegrationsStatusCards status={data.integrations} />
        </div>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Consumo da IA perto do limite</CardTitle>
          </CardHeader>
          <AiLimitAlerts rows={data.aiLimitAlerts} />
        </Card>
      </div>
    </>
  );
}
