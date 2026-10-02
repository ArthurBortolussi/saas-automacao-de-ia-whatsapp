import type { AiStatusResponse } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { DetailList } from "@/components/detail-list";
import { formatDateTime, formatNumber, WEEKDAY_SHORT } from "@/lib/format";

/** Estado da IA de uma empresa: se está respondendo agora e, se não, por quê. Nunca mostra a chave. */
export function AiStatusCard({ status }: { status: AiStatusResponse }) {
  const { settings, platform, knowledge } = status;
  const answering = status.blockers.length === 0;
  const schedule = settings.alwaysOn
    ? "24 horas"
    : `${settings.scheduleDays.map((day) => WEEKDAY_SHORT[day]).join(", ")} · ${settings.scheduleStart}–${settings.scheduleEnd} (${settings.timezone})`;
  const overLimit = knowledge.activeChars > knowledge.contextLimitChars;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Estado da IA</CardTitle>
          <Badge variant={answering ? "default" : "secondary"}>{answering ? "Respondendo" : "Não está respondendo"}</Badge>
        </div>
      </CardHeader>
      {status.blockers.length > 0 ? (
        <ul className="space-y-1 border-b px-5 py-3 text-sm text-muted-foreground">
          {status.blockers.map((blocker) => (
            <li key={blocker}>• {blocker}</li>
          ))}
        </ul>
      ) : null}
      <DetailList
        items={[
          { label: "IA na empresa", value: settings.enabled ? "Ligada" : "Desligada" },
          { label: "Modelo", value: platform.configured ? `${platform.model}${platform.simulated ? " (API SIMULADA)" : ""}` : "Não configurado no servidor" },
          { label: "Horário da IA", value: `${schedule}${status.withinSchedule ? "" : " · fora do horário agora"}` },
          { label: "Novas conversas", value: settings.defaultConversationMode === "AI" ? "Começam com a IA" : "Começam com atendimento humano" },
          {
            label: "Base de conhecimento",
            value: `${formatNumber(knowledge.active)} de ${formatNumber(knowledge.total)} informações ativas · ${formatNumber(knowledge.activeChars)} caracteres${
              overLimit ? ` (acima de ${formatNumber(knowledge.contextLimitChars)}: a IA usa só os trechos mais relacionados a cada conversa)` : ""
            }`,
          },
          { label: "Última alteração", value: settings.updatedAt ? formatDateTime(settings.updatedAt) : "Usando os valores padrão" },
        ]}
      />
    </Card>
  );
}
