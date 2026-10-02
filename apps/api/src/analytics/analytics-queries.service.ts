import { Injectable } from "@nestjs/common";
import { Prisma } from "@arthur-ai/database";
import {
  AI_USAGE_SOURCES,
  usageSourceOf,
  type AiApiSource,
  type AiUsageBucket,
  type AiUsageSource,
  type ClosedBreakdown,
  type CompanyStatus,
  type CompanyUsageRow,
  type CurrentSituation,
  type CycleBreakdown,
  type DailyPoint,
  type MessageVolume,
  type TeamSummary,
} from "@arthur-ai/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ReportWindow } from "./period.js";

/** null = plataforma inteira (somente SUPERADMIN); string = UMA empresa (sempre o id validado pelo guard). */
export type Scope = string | null;

const COMPANY_TABLE_LIMIT = 500;

/** Filtro de empresa: fragmento parametrizado, nunca texto concatenado. */
function scoped(column: Prisma.Sql, companyId: Scope): Prisma.Sql {
  return companyId ? Prisma.sql`AND ${column} = ${companyId}::uuid` : Prisma.empty;
}

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(6);
const int = (value: bigint | number | null | undefined) => Number(value ?? 0);

/*
 * Classificação de cada ciclo pelo histórico ATÉ o instante de referência (T = window.to). Todo marco do ciclo
 * tem horário; um marco posterior a T conta como "ainda não aconteceu". Assim a tela e a exportação feitas com o
 * mesmo T produzem os mesmos números, mesmo que o atendimento tenha evoluído entre uma e outra.
 *   humano     = atribuído a um funcionário OU com mensagem de funcionário (até T)
 *   na fila    = entrou na fila humana (até T)
 *   IA         = a IA respondeu ou transferiu (até T)
 * Categorias exclusivas: humano | fila sem humano | IA sem fila e sem humano | nenhum dos três.
 */
function classified(window: ReportWindow, companyId: Scope): Prisma.Sql {
  const t = window.to;
  return Prisma.sql`
    SELECT y.*,
           (y."firstAssignedAt" <= ${t} OR y."firstHumanReplyAt" <= ${t}) IS TRUE AS "human",
           (y."firstQueuedAt" <= ${t}) IS TRUE AS "queued",
           (y."aiFirstAt" <= ${t}) IS TRUE AS "ai",
           (y."closedAt" <= ${t}) IS TRUE AS "closed"
      FROM "ConversationCycle" y
     WHERE y."startedAt" <= ${t} ${scoped(Prisma.sql`y."companyId"`, companyId)}`;
}

interface CycleRow {
  started: number;
  aiOnlyClosed: number;
  aiOnlyClosedInactivity: number;
  aiOnlyOpen: number;
  withHuman: number;
  awaitingHuman: number;
  withoutResponse: number;
  aiTransferred: number;
  reconstructed: number;
  frtAvg: number | null;
  frtSamples: number;
  withoutHumanReply: number;
  waitAvg: number | null;
  waitSamples: number;
}

/** Consultas agregadas do Analytics. Só leitura; agregação feita no PostgreSQL. */
@Injectable()
export class AnalyticsQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Atendimentos iniciados no período (coorte), tempos de resposta e de fila desses atendimentos. */
  async cycles(window: ReportWindow, companyId: Scope): Promise<{ cycles: CycleBreakdown; team: Omit<TeamSummary, "humanClosed" | "humanInProgress"> }> {
    const t = window.to;
    const [row] = await this.prisma.$queryRaw<CycleRow[]>`
      SELECT count(*)::int AS "started",
             count(*) FILTER (WHERE c."ai" AND NOT c."queued" AND NOT c."human" AND c."closed")::int AS "aiOnlyClosed",
             count(*) FILTER (WHERE c."ai" AND NOT c."queued" AND NOT c."human" AND c."closed" AND c."closeReason" = 'INACTIVITY')::int AS "aiOnlyClosedInactivity",
             count(*) FILTER (WHERE c."ai" AND NOT c."queued" AND NOT c."human" AND NOT c."closed")::int AS "aiOnlyOpen",
             count(*) FILTER (WHERE c."human")::int AS "withHuman",
             count(*) FILTER (WHERE c."queued" AND NOT c."human")::int AS "awaitingHuman",
             count(*) FILTER (WHERE NOT c."ai" AND NOT c."queued" AND NOT c."human")::int AS "withoutResponse",
             count(*) FILTER (WHERE c."aiHandoffCount" > 0 AND c."ai")::int AS "aiTransferred",
             count(*) FILTER (WHERE c."origin" = 'BACKFILL')::int AS "reconstructed",
             avg(extract(epoch FROM (c."firstHumanReplyAt" - c."humanRequestedAt")))
               FILTER (WHERE c."firstHumanReplyAt" <= ${t} AND c."firstHumanReplyAt" >= c."humanRequestedAt")::float8 AS "frtAvg",
             count(*) FILTER (WHERE c."firstHumanReplyAt" <= ${t} AND c."firstHumanReplyAt" >= c."humanRequestedAt")::int AS "frtSamples",
             count(*) FILTER (WHERE c."humanRequestedAt" <= ${t} AND (c."firstHumanReplyAt" IS NULL OR c."firstHumanReplyAt" > ${t}))::int AS "withoutHumanReply",
             (avg(c."queueWaitMs") FILTER (WHERE c."queueWaitCount" > 0 AND c."firstAssignedAt" <= ${t}) / 1000)::float8 AS "waitAvg",
             count(*) FILTER (WHERE c."queueWaitCount" > 0 AND c."firstAssignedAt" <= ${t})::int AS "waitSamples"
        FROM (${classified(window, companyId)}) c
       WHERE c."startedAt" >= ${window.from}`;
    const r = row ?? ({} as Partial<CycleRow>);
    return {
      cycles: {
        started: int(r.started),
        aiOnlyClosed: int(r.aiOnlyClosed),
        aiOnlyClosedInactivity: int(r.aiOnlyClosedInactivity),
        aiOnlyOpen: int(r.aiOnlyOpen),
        withHuman: int(r.withHuman),
        awaitingHuman: int(r.awaitingHuman),
        withoutResponse: int(r.withoutResponse),
        aiTransferred: int(r.aiTransferred),
        reconstructed: int(r.reconstructed),
      },
      team: {
        humanCycles: int(r.withHuman),
        firstResponse: { averageSeconds: r.frtSamples ? (r.frtAvg ?? null) : null, samples: int(r.frtSamples) },
        withoutHumanReply: int(r.withoutHumanReply),
        queueWait: { averageSeconds: r.waitSamples ? (r.waitAvg ?? null) : null, samples: int(r.waitSamples) },
      },
    };
  }

  /** Encerramentos ocorridos no período (pelo horário do encerramento, inclusive de ciclos iniciados antes). */
  async closed(window: ReportWindow, companyId: Scope): Promise<ClosedBreakdown> {
    const [row] = await this.prisma.$queryRaw<ClosedBreakdown[]>`
      SELECT count(*)::int AS "total",
             count(*) FILTER (WHERE c."closeReason" = 'MANUAL')::int AS "manual",
             count(*) FILTER (WHERE c."closeReason" = 'INACTIVITY')::int AS "inactivity",
             count(*) FILTER (WHERE c."human")::int AS "withHuman"
        FROM (${classified(window, companyId)}) c
       WHERE c."closedAt" >= ${window.from} AND c."closedAt" <= ${window.to}`;
    return { total: int(row?.total), manual: int(row?.manual), inactivity: int(row?.inactivity), withHuman: int(row?.withHuman) };
  }

  /** Série diária no fuso do relatório: iniciados (por categoria) e encerrados. Dias sem dados valem zero. */
  async daily(window: ReportWindow, companyId: Scope): Promise<DailyPoint[]> {
    const tz = window.timezone;
    const started = await this.prisma.$queryRaw<{ day: string; started: number; aiOnly: number; withHuman: number }[]>`
      SELECT to_char(c."startedAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS "day",
             count(*)::int AS "started",
             count(*) FILTER (WHERE c."ai" AND NOT c."queued" AND NOT c."human")::int AS "aiOnly",
             count(*) FILTER (WHERE c."human")::int AS "withHuman"
        FROM (${classified(window, companyId)}) c
       WHERE c."startedAt" >= ${window.from}
       GROUP BY 1`;
    const closed = await this.prisma.$queryRaw<{ day: string; closed: number }[]>`
      SELECT to_char(y."closedAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS "day", count(*)::int AS "closed"
        FROM "ConversationCycle" y
       WHERE y."closedAt" >= ${window.from} AND y."closedAt" <= ${window.to} ${scoped(Prisma.sql`y."companyId"`, companyId)}
       GROUP BY 1`;
    const startedByDay = new Map(started.map((row) => [row.day, row]));
    const closedByDay = new Map(closed.map((row) => [row.day, int(row.closed)]));
    return window.days.map((date) => {
      const day = startedByDay.get(date);
      return {
        date,
        started: int(day?.started),
        aiOnly: int(day?.aiOnly),
        withHuman: int(day?.withHuman),
        closed: closedByDay.get(date) ?? 0,
      };
    });
  }

  /** Situação AGORA: conversas não encerradas por estado. Não depende do período. */
  async current(companyId: Scope): Promise<CurrentSituation> {
    const asOf = new Date();
    const [row] = await this.prisma.$queryRaw<Omit<CurrentSituation, "asOf">[]>`
      SELECT count(*) FILTER (WHERE c."status" <> 'CLOSED')::int AS "inProgress",
             count(*) FILTER (WHERE c."status" = 'OPEN' AND c."mode" = 'AI')::int AS "withAi",
             count(*) FILTER (WHERE c."status" = 'QUEUED')::int AS "queued",
             count(*) FILTER (WHERE c."status" = 'ASSIGNED')::int AS "withAgent",
             count(*) FILTER (WHERE c."status" = 'OPEN' AND c."mode" <> 'AI')::int AS "other"
        FROM "Conversation" c
       WHERE TRUE ${scoped(Prisma.sql`c."companyId"`, companyId)}`;
    return {
      asOf: asOf.toISOString(),
      inProgress: int(row?.inProgress),
      withAi: int(row?.withAi),
      queued: int(row?.queued),
      withAgent: int(row?.withAgent),
      other: int(row?.other),
    };
  }

  /** Mensagens no período. Recebidas são únicas por wamid (índice único): reenvios do webhook não duplicam. */
  async messages(window: ReportWindow, companyId: Scope): Promise<MessageVolume> {
    const [row] = await this.prisma.$queryRaw<MessageVolume[]>`
      SELECT count(*) FILTER (WHERE m."direction" = 'INBOUND')::int AS "inbound",
             count(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."senderType" = 'AI')::int AS "outboundAi",
             count(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."senderType" = 'AGENT')::int AS "outboundAgent",
             count(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."senderType" = 'SYSTEM')::int AS "outboundSystem",
             count(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."deliveryStatus" = 'FAILED')::int AS "outboundFailed"
        FROM "Message" m
       WHERE m."createdAt" >= ${window.from} AND m."createdAt" <= ${window.to} ${scoped(Prisma.sql`m."companyId"`, companyId)}`;
    return {
      inbound: int(row?.inbound),
      outboundAi: int(row?.outboundAi),
      outboundAgent: int(row?.outboundAgent),
      outboundSystem: int(row?.outboundSystem),
      outboundFailed: int(row?.outboundFailed),
    };
  }

  /**
   * Consumo da IA por origem. O custo de cada execução foi estimado e gravado na hora (pricing.ts, Fase 4):
   * aqui só se soma (numeric no banco, sem arredondamentos intermediários). Custo médio por atendimento =
   * custo das execuções do período ligadas a um atendimento ÷ atendimentos distintos com custo conhecido.
   */
  async aiUsage(window: ReportWindow, companyId: Scope): Promise<AiUsageBucket[]> {
    const rows = await this.prisma.$queryRaw<
      {
        apiSource: AiApiSource | null;
        runs: number;
        inputTokens: bigint;
        outputTokens: bigint;
        cacheCreationInputTokens: bigint;
        cacheReadInputTokens: bigint;
        cost: Prisma.Decimal | null;
        runsWithoutCost: number;
        cyclesWithCost: number;
        cycleCost: Prisma.Decimal | null;
      }[]
    >`
      SELECT r."apiSource",
             count(*)::int AS "runs",
             COALESCE(sum(r."inputTokens"), 0)::bigint AS "inputTokens",
             COALESCE(sum(r."outputTokens"), 0)::bigint AS "outputTokens",
             COALESCE(sum(r."cacheCreationInputTokens"), 0)::bigint AS "cacheCreationInputTokens",
             COALESCE(sum(r."cacheReadInputTokens"), 0)::bigint AS "cacheReadInputTokens",
             sum(r."costUsd") AS "cost",
             count(*) FILTER (WHERE r."costUsd" IS NULL)::int AS "runsWithoutCost",
             count(DISTINCT r."cycleId") FILTER (WHERE r."costUsd" IS NOT NULL AND r."cycleId" IS NOT NULL)::int AS "cyclesWithCost",
             sum(r."costUsd") FILTER (WHERE r."cycleId" IS NOT NULL) AS "cycleCost"
        FROM "AiRun" r
       WHERE r."createdAt" >= ${window.from} AND r."createdAt" <= ${window.to} ${scoped(Prisma.sql`r."companyId"`, companyId)}
       GROUP BY r."apiSource"`;
    const bySource = new Map<AiUsageSource, (typeof rows)[number]>();
    for (const row of rows) bySource.set(usageSourceOf(row.apiSource), row);
    return AI_USAGE_SOURCES.map((source) => {
      const row = bySource.get(source);
      const cycles = int(row?.cyclesWithCost);
      return {
        source,
        runs: int(row?.runs),
        inputTokens: int(row?.inputTokens),
        outputTokens: int(row?.outputTokens),
        cacheCreationInputTokens: int(row?.cacheCreationInputTokens),
        cacheReadInputTokens: int(row?.cacheReadInputTokens),
        estimatedCostUsd: money(row?.cost),
        runsWithoutCost: int(row?.runsWithoutCost),
        cyclesWithCost: cycles,
        averageCostPerCycleUsd: cycles > 0 && row?.cycleCost ? row.cycleCost.div(cycles).toFixed(6) : null,
      };
    });
  }

  async companies(window: ReportWindow): Promise<{ total: number; withActivity: number }> {
    const [row] = await this.prisma.$queryRaw<{ total: number; withActivity: number }[]>`
      SELECT (SELECT count(*)::int FROM "Company") AS "total",
             (SELECT count(*)::int FROM (
                SELECT y."companyId" FROM "ConversationCycle" y WHERE y."startedAt" >= ${window.from} AND y."startedAt" <= ${window.to}
                UNION
                SELECT m."companyId" FROM "Message" m WHERE m."createdAt" >= ${window.from} AND m."createdAt" <= ${window.to}
              ) a) AS "withActivity"`;
    return { total: int(row?.total), withActivity: int(row?.withActivity) };
  }

  /** Resumo por empresa (consumo oficial separado de simulado/não verificado). */
  async byCompany(window: ReportWindow): Promise<CompanyUsageRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        companyId: string;
        name: string;
        status: CompanyStatus;
        cyclesStarted: number;
        aiRuns: number;
        totalTokens: bigint;
        costOfficial: Prisma.Decimal | null;
        costOther: Prisma.Decimal | null;
      }[]
    >`
      SELECT c."id" AS "companyId", c."name", c."status",
             (SELECT count(*)::int FROM "ConversationCycle" y
               WHERE y."companyId" = c."id" AND y."startedAt" >= ${window.from} AND y."startedAt" <= ${window.to}) AS "cyclesStarted",
             COALESCE(r."runs", 0)::int AS "aiRuns",
             COALESCE(r."tokens", 0)::bigint AS "totalTokens",
             r."costOfficial", r."costOther"
        FROM "Company" c
        LEFT JOIN (
          SELECT a."companyId", count(*) AS "runs",
                 sum(COALESCE(a."inputTokens", 0) + COALESCE(a."outputTokens", 0)
                     + COALESCE(a."cacheCreationInputTokens", 0) + COALESCE(a."cacheReadInputTokens", 0)) AS "tokens",
                 sum(a."costUsd") FILTER (WHERE a."apiSource" = 'OFFICIAL') AS "costOfficial",
                 sum(a."costUsd") FILTER (WHERE a."apiSource" IS DISTINCT FROM 'OFFICIAL') AS "costOther"
            FROM "AiRun" a
           WHERE a."createdAt" >= ${window.from} AND a."createdAt" <= ${window.to}
           GROUP BY a."companyId"
        ) r ON r."companyId" = c."id"
       ORDER BY r."costOfficial" DESC NULLS LAST, "aiRuns" DESC, "cyclesStarted" DESC, c."name" ASC
       LIMIT ${COMPANY_TABLE_LIMIT}`;
    return rows.map((row) => ({
      companyId: row.companyId,
      name: row.name,
      status: row.status,
      cyclesStarted: int(row.cyclesStarted),
      aiRuns: int(row.aiRuns),
      totalTokens: int(row.totalTokens),
      costOfficialUsd: money(row.costOfficial),
      costNotOfficialUsd: money(row.costOther),
    }));
  }
}
