import {
  formatDurationPt,
  type AnalyticsPeriodInfo,
  type ClosedBreakdown,
  type CurrentSituation,
  type CycleBreakdown,
  type DailyPoint,
  type TeamSummary,
} from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { DailyChart } from "./daily-chart";
import { DistributionBar } from "./distribution-bar";
import { StatCard } from "./stat-card";

export interface OperationalData {
  period: AnalyticsPeriodInfo;
  cycles: CycleBreakdown;
  closed: ClosedBreakdown;
  current: CurrentSituation;
  team: TeamSummary;
  daily: DailyPoint[];
}

const timeOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dateTimeOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

function Detail({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint ? <span className="block text-xs">{hint}</span> : null}
      </dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Texto do recorte usado em todos os números históricos da página. */
export function PeriodNote({ period }: { period: AnalyticsPeriodInfo }) {
  return (
    <p className="text-xs text-muted-foreground">
      {period.label}: de {dateTimeOf(period.from, period.timezone)} até {dateTimeOf(period.to, period.timezone)} · fuso {period.timezone}
    </p>
  );
}

/**
 * Indicadores operacionais (sem nenhum dado financeiro). Linguagem para o dono do negócio: atendimento = cada vez que
 * um cliente é atendido do início ao encerramento; uma conversa reaberta conta como novo atendimento.
 */
export function OperationalView({ data }: { data: OperationalData }) {
  const { cycles, closed, current, team, period } = data;
  const aiOnly = cycles.aiOnlyClosed + cycles.aiOnlyOpen;
  const tz = period.timezone;
  const nowTag = `Agora · ${timeOf(current.asOf, tz)}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Atendimentos" value={formatNumber(cycles.started)} hint="Iniciados no período" />
        <StatCard
          label="Atendidos somente pela IA"
          value={formatNumber(aiOnly)}
          hint={`${formatNumber(cycles.aiOnlyOpen)} em andamento · ${formatNumber(cycles.aiOnlyClosedInactivity)} encerrados por inatividade${
            cycles.aiOnlyClosed > cycles.aiOnlyClosedInactivity ? ` · ${formatNumber(cycles.aiOnlyClosed - cycles.aiOnlyClosedInactivity)} finalizados manualmente` : ""
          }`}
        />
        <StatCard label="Atendimento humano" value={formatNumber(cycles.withHuman)} hint="Com participação de alguém da equipe" />
        <StatCard
          label="Encerrados no período"
          value={formatNumber(closed.total)}
          hint={`${formatNumber(closed.manual)} manualmente · ${formatNumber(closed.inactivity)} por inatividade`}
        />
        <StatCard
          label="Em andamento"
          tag={nowTag}
          value={formatNumber(current.inProgress)}
          hint={`${formatNumber(current.withAi)} com a IA · ${formatNumber(current.queued)} na fila · ${formatNumber(current.withAgent)} com a equipe`}
        />
        <StatCard
          label="Primeira resposta humana"
          value={formatDurationPt(team.firstResponse.averageSeconds)}
          muted={team.firstResponse.averageSeconds === null}
          hint={team.firstResponse.samples ? `Média de ${formatNumber(team.firstResponse.samples)} atendimento(s)` : "Nenhuma resposta da equipe medida no período"}
        />
        <StatCard
          label="Tempo de espera na fila"
          value={formatDurationPt(team.queueWait.averageSeconds)}
          muted={team.queueWait.averageSeconds === null}
          hint={team.queueWait.samples ? `Média de ${formatNumber(team.queueWait.samples)} atendimento(s)` : "Nenhuma espera concluída no período"}
        />
        <StatCard
          label="Aguardando na fila"
          tag={nowTag}
          value={formatNumber(current.queued)}
          hint="Clientes esperando alguém da equipe"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        &quot;Atendidos somente pela IA&quot; significa que não houve transferência nem participação da equipe — não garante que o problema do
        cliente foi resolvido. &quot;Encerrado por inatividade&quot; quer dizer apenas que o cliente parou de responder. Os números marcados com &quot;Agora&quot; mostram a situação atual, independentemente do período escolhido.
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Atendimentos por dia</CardTitle>
            <CardDescription>Atendimentos iniciados em cada dia do período</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart daily={data.daily} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">IA e equipe</CardTitle>
            <CardDescription>Quem conduziu os atendimentos iniciados no período</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionBar cycles={cycles} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados gerais da equipe</CardTitle>
            <CardDescription>Números da equipe como um todo, sem comparação entre pessoas</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Detail label="Atendimentos humanos" value={formatNumber(team.humanCycles)} hint="Iniciados no período" />
              <Detail label="Atendimentos humanos encerrados" value={formatNumber(team.humanClosed)} hint="Encerrados no período" />
              <Detail label="Conversas com a equipe agora" value={formatNumber(team.humanInProgress)} />
              <Detail label="Primeira resposta humana (média)" value={formatDurationPt(team.firstResponse.averageSeconds)} />
              <Detail label="Tempo de espera na fila (média)" value={formatDurationPt(team.queueWait.averageSeconds)} />
              <Detail label="Pedidos ainda sem resposta da equipe" value={formatNumber(team.withoutHumanReply)} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mais detalhes</CardTitle>
            <CardDescription>Transferências, fila e encerramentos</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Detail label="Transferidos pela IA para a equipe" value={formatNumber(cycles.aiTransferred)} hint="Atendimentos iniciados no período" />
              <Detail label="Aguardando atendimento humano" value={formatNumber(cycles.awaitingHuman)} hint="Iniciados no período e ainda sem a equipe" />
              <Detail label="Sem resposta da IA ou da equipe" value={formatNumber(cycles.withoutResponse)} hint="Ex.: IA desligada ou fora do horário" />
              <Detail label="Finalizados manualmente" value={formatNumber(closed.manual)} />
              <Detail label="Finalizados por inatividade" value={formatNumber(closed.inactivity)} />
              <Detail label="Pausados ou sem responsável agora" value={formatNumber(current.other)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {cycles.reconstructed > 0 ? (
        <p className="text-xs text-muted-foreground">
          {formatNumber(cycles.reconstructed)} atendimento(s) deste período começaram antes da ativação do Analytics: entram nas contagens, mas não nas
          médias de tempo.
        </p>
      ) : null}
    </div>
  );
}
