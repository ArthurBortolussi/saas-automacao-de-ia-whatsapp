import type { AiStatusResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { PageHeader } from "@/components/page-header";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const { companyId } = await requireMembership();
  const status = await fetchPageData<AiStatusResponse>(`/companies/${companyId}/ai`);
  return (
    <>
      <PageHeader title="Configurações" description="Atendimento automático com inteligência artificial." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atendimento com IA</CardTitle>
            <CardDescription>Ligar ou desligar a IA e o modo inicial das conversas são definidos pelo suporte do Arthur AI.</CardDescription>
          </CardHeader>
          <CardContent>
            <AiSettingsForm companyId={companyId} status={status} scope="company" />
          </CardContent>
        </Card>
        <div>
          <AiStatusCard status={status} />
        </div>
      </div>
    </>
  );
}
