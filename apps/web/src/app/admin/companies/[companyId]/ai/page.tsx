import type { AiStatusResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { fetchPageData } from "@/lib/api-server";

export default async function CompanyAiPage({ params }: PageProps<"/admin/companies/[companyId]/ai">) {
  const { companyId } = await params;
  const status = await fetchPageData<AiStatusResponse>(`/companies/${encodeURIComponent(companyId)}/ai`);

  return (
    <div className="space-y-6">
      {!status.platform.configured ? (
        <Alert>
          <AlertTitle>IA não configurada neste servidor</AlertTitle>
          <AlertDescription>
            Defina ANTHROPIC_API_KEY nas variáveis de ambiente da API (veja o README). O restante do sistema funciona normalmente.
          </AlertDescription>
        </Alert>
      ) : status.platform.simulated ? (
        <Alert>
          <AlertTitle>API da Anthropic SIMULADA</AlertTitle>
          <AlertDescription>Este servidor aponta para um simulador local: as respostas não vêm do Claude de verdade.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assistente desta empresa</CardTitle>
            <CardDescription>O que vale só para esta empresa. O modelo e a chave do provedor são configurados no servidor.</CardDescription>
          </CardHeader>
          <CardContent>
            <AiSettingsForm companyId={companyId} status={status} scope="admin" />
          </CardContent>
        </Card>
        <div>
          <AiStatusCard status={status} />
        </div>
      </div>
    </div>
  );
}
