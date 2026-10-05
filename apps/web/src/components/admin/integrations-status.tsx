import type { IntegrationEnvironment, IntegrationsStatus } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { DetailList } from "@/components/detail-list";
import { formatDateTime } from "@/lib/format";

const ENVIRONMENT_LABEL: Record<IntegrationEnvironment, string> = {
  OFFICIAL: "Oficial (produção)",
  SIMULATED: "Simulado (servidor local de teste)",
  NOT_CONFIGURED: "Não configurada",
};

/**
 * Estado BÁSICO das integrações, só com fatos verificáveis. Configurada ≠ conectada: nenhuma linha afirma que a
 * conexão real foi validada, e o simulador é sempre identificado como tal.
 */
export function IntegrationsStatusCards({ status }: { status: IntegrationsStatus }) {
  const { whatsapp, anthropic } = status;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">WhatsApp Cloud API</CardTitle>
            <Badge variant={whatsapp.environment === "OFFICIAL" ? "info" : "neutral"}>{ENVIRONMENT_LABEL[whatsapp.environment]}</Badge>
          </div>
        </CardHeader>
        <DetailList
          items={[
            { label: "Configurada no servidor", value: whatsapp.configured ? `Sim (Graph API ${whatsapp.graphApiVersion})` : "Não" },
            {
              label: "Números por estado",
              value: `${whatsapp.accounts.active} ativos · ${whatsapp.accounts.pending} pendentes · ${whatsapp.accounts.error} com erro · ${whatsapp.accounts.disabled} desativados`,
            },
            { label: "Último webhook recebido", value: whatsapp.lastWebhookAt ? formatDateTime(whatsapp.lastWebhookAt) : "Nenhum" },
            { label: "Último envio aceito", value: whatsapp.lastSentAt ? formatDateTime(whatsapp.lastSentAt) : "Nenhum" },
          ]}
        />
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          {whatsapp.environment === "SIMULATED"
            ? "Envios aceitos pelo simulador não provam a conexão com a Meta. A integração real ainda precisa ser validada com um número de verdade."
            : "Credencial configurada não prova a conexão: confira o teste de cada número na aba WhatsApp da empresa."}
        </p>
      </Card>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Anthropic (IA)</CardTitle>
            <Badge variant={anthropic.environment === "OFFICIAL" ? "info" : "neutral"}>{ENVIRONMENT_LABEL[anthropic.environment]}</Badge>
          </div>
        </CardHeader>
        <DetailList
          items={[
            { label: "Configurada no servidor", value: anthropic.configured ? `Sim (modelo ${anthropic.model})` : "Não (chave ausente)" },
            { label: "Empresas com a IA ligada", value: `${anthropic.companiesEnabled} (${anthropic.companiesPaused} pausadas pela empresa)` },
            { label: "Última resposta pela API oficial", value: anthropic.lastOfficialSuccessAt ? formatDateTime(anthropic.lastOfficialSuccessAt) : "Nenhuma" },
            { label: "Última resposta pelo simulador", value: anthropic.lastSimulatedSuccessAt ? formatDateTime(anthropic.lastSimulatedSuccessAt) : "Nenhuma" },
          ]}
        />
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Respostas do simulador não são do Claude. Só uma resposta pela API oficial é evidência de que a chave real funciona.
        </p>
      </Card>
    </div>
  );
}
