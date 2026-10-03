import type { CompanyAlertsResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import Link from "next/link";
import { AI_USAGE_LEVEL_LABEL, formatMinutesShort } from "@/lib/format";

/** Alertas do painel da empresa (OWNER/ADMIN): espera excessiva, IA pausada e uso da IA — nunca valores financeiros. */
export function CompanyAlerts({ alerts }: { alerts: CompanyAlertsResponse }) {
  const items = [];
  if (alerts.queue.overdue > 0) {
    items.push(
      <Alert key="queue" variant="destructive">
        <AlertTitle>
          {alerts.queue.overdue === 1 ? "1 conversa" : `${alerts.queue.overdue} conversas`} esperando há mais de {formatMinutesShort(alerts.queue.maxQueueWaitMinutes)}
        </AlertTitle>
        <AlertDescription>
          De {alerts.queue.waiting} na fila. Elas continuam na mesma posição e a distribuição segue automática.{" "}
          <Link href="/dashboard/inbox?filter=queued" prefetch={false} className="underline underline-offset-4">
            Ver a fila
          </Link>
        </AlertDescription>
      </Alert>,
    );
  }
  if (alerts.aiUsage === "NEAR_LIMIT" || alerts.aiUsage === "LIMIT_REACHED") {
    items.push(
      <Alert key="usage" variant={alerts.aiUsage === "LIMIT_REACHED" ? "destructive" : "default"}>
        <AlertTitle>{AI_USAGE_LEVEL_LABEL[alerts.aiUsage]}</AlertTitle>
        <AlertDescription>
          {alerts.aiUsage === "LIMIT_REACHED"
            ? "A IA não inicia novos atendimentos neste mês; eles vão para a equipe. Fale com o suporte se precisar de mais capacidade."
            : "A empresa está próxima do limite de uso da IA deste mês."}
        </AlertDescription>
      </Alert>,
    );
  }
  if (alerts.aiPaused) {
    items.push(
      <Alert key="paused">
        <AlertTitle>A IA está pausada</AlertTitle>
        <AlertDescription>
          Novas mensagens vão para a equipe.{" "}
          <Link href="/dashboard/settings/ai" prefetch={false} className="underline underline-offset-4">
            Configurações da IA
          </Link>
        </AlertDescription>
      </Alert>,
    );
  }
  return items.length ? <div className="mb-6 space-y-3">{items}</div> : null;
}
