import type { AiStatusResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { AiPauseControl } from "@/components/settings/ai-pause-control";
import { fetchPageData, requireMembership } from "@/lib/api-server";
import { AI_USAGE_LEVEL_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Configurações · IA" };

export default async function AiSettingsPage() {
  const { companyId } = await requireMembership();
  const status = await fetchPageData<AiStatusResponse>(`/companies/${companyId}/ai`);
  const nearLimit = status.usageLevel === "NEAR_LIMIT" || status.usageLevel === "LIMIT_REACHED";
  return (
    <div className="space-y-6">
      {nearLimit && status.usageLevel ? (
        <Alert variant={status.usageLevel === "LIMIT_REACHED" ? "destructive" : "default"}>
          <AlertTitle>{AI_USAGE_LEVEL_LABEL[status.usageLevel]}</AlertTitle>
          <AlertDescription>
            {status.usageLevel === "LIMIT_REACHED"
              ? "Novos atendimentos estão sendo encaminhados para a equipe até a renovação do mês ou um ajuste do suporte."
              : "A empresa está próxima do limite mensal de uso da IA. Fale com o suporte se precisar de mais capacidade."}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pausa da IA</CardTitle>
              <CardDescription>Interrompe temporariamente as respostas automáticas. Ligar ou desligar a IA é feito pelo suporte.</CardDescription>
            </CardHeader>
            <CardContent>
              <AiPauseControl companyId={companyId} status={status} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Atendimento com IA</CardTitle>
              <CardDescription>Nome, tom, orientações, mensagem de transferência e encerramento automático.</CardDescription>
            </CardHeader>
            <CardContent>
              <AiSettingsForm companyId={companyId} status={status} scope="company" />
            </CardContent>
          </Card>
        </div>
        <div>
          <AiStatusCard status={status} />
        </div>
      </div>
    </div>
  );
}
