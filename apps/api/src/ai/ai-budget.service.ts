import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type AiApiSource, type Company } from "@arthur-ai/database";
import { aiUsageLevel, AI_USAGE_NEAR_LIMIT_PERCENT, type AiBudgetView, type AiUsageLevel } from "@arthur-ai/shared";
import { safeTimeZone } from "../analytics/period.js";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

type Db = Prisma.TransactionClient;

/** Reserva vale mais que o pior caso de uma execução (ver LOCK_MS do worker): API que caiu não trava o saldo. */
const RESERVATION_TTL_MS = 10 * 60_000;

export type BudgetDecision = { allowed: true } | { allowed: false; reason: "LIMIT_REACHED" | "PRICE_UNKNOWN" };

interface MonthUsage {
  month: string;
  /** Gasto estimado no mês por origem (AiRun.costUsd). */
  spent: Record<AiApiSource | "UNVERIFIED", { usd: Prisma.Decimal; runs: number }>;
  /** Reservas ativas da origem aplicada. */
  reserved: Prisma.Decimal;
}

/**
 * FASE 7: limite mensal de custo ESTIMADO da IA por empresa (USD), por mês de calendário no fuso da empresa.
 *
 * - Fonte do gasto: AiRun.costUsd (a mesma estimativa da aba Uso e do Analytics; nenhuma fórmula nova). Nada é
 *   zerado: o mês novo simplesmente não soma os registros do mês anterior.
 * - Origens separadas: o bloqueio soma só a origem deste servidor (API oficial OU simulador). Consumo simulado
 *   nunca conta como custo real e vice-versa; registros sem origem (anteriores à Fase 6) não entram.
 * - Concorrência: antes de chamar o modelo, a execução RESERVA uma estimativa conservadora sob uma trava por empresa
 *   (pg_advisory_xact_lock). Gasto + reservas + estimativa acima do limite → a IA não inicia a geração. Ao gravar o
 *   custo real (AiRun), a reserva é removida na mesma transação.
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Origem que o bloqueio considera neste servidor. */
  get enforcedSource(): AiApiSource {
    return this.env.ai.simulated ? "SIMULATED" : "OFFICIAL";
  }

  /** Gasto do mês (fuso da empresa) por origem e reservas ativas, numa ÚNICA consulta (um só retrato do banco). */
  async monthUsage(companyId: string, timezone: string, db: Db = this.prisma): Promise<MonthUsage> {
    const tz = safeTimeZone(timezone);
    const source = this.enforcedSource;
    const rows = await db.$queryRaw<{ source: string; spent: string; runs: number; reserved: string; month: string }[]>`
      WITH bounds AS (
        SELECT (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS "start",
               to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM') AS "month"
      ), usage AS (
        SELECT COALESCE(r."apiSource"::text, 'UNVERIFIED') AS "source", COALESCE(sum(r."costUsd"), 0)::text AS "spent", count(*)::int AS "runs"
          FROM "AiRun" r, bounds b
         WHERE r."companyId" = ${companyId}::uuid AND r."createdAt" >= b."start"
         GROUP BY 1
      )
      SELECT s."source", COALESCE(u."spent", '0') AS "spent", COALESCE(u."runs", 0) AS "runs",
             (SELECT COALESCE(sum(x."amountUsd"), 0)::text FROM "AiBudgetReservation" x
               WHERE x."companyId" = ${companyId}::uuid AND x."apiSource" = ${source}::"AiApiSource" AND x."expiresAt" > now()) AS "reserved",
             (SELECT "month" FROM bounds) AS "month"
        FROM (VALUES ('OFFICIAL'), ('SIMULATED'), ('UNVERIFIED')) AS s("source")
        LEFT JOIN usage u ON u."source" = s."source"`;
    const spent = {} as MonthUsage["spent"];
    for (const row of rows) spent[row.source as AiApiSource | "UNVERIFIED"] = { usd: new Prisma.Decimal(row.spent), runs: row.runs };
    return { month: rows[0]?.month ?? "", spent, reserved: new Prisma.Decimal(rows[0]?.reserved ?? "0") };
  }

  /**
   * Reserva a estimativa da execução (id = runId do lote). Sem limite configurado: sempre permitido, sem reserva.
   * Com limite e sem preço conhecido para o modelo, o limite não pode ser garantido: não gera (falha fechada).
   */
  async reserve(company: Pick<Company, "id" | "timezone">, reservationId: string, estimateUsd: string | null): Promise<BudgetDecision> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-budget:${company.id}`}, 0))`;
      const settings = await tx.aiSettings.findUnique({ where: { companyId: company.id }, select: { monthlyLimitUsd: true } });
      const limit = settings?.monthlyLimitUsd ?? null;
      if (limit === null) return { allowed: true };
      if (estimateUsd === null) return { allowed: false, reason: "PRICE_UNKNOWN" };
      const usage = await this.monthUsage(company.id, company.timezone, tx);
      const committed = usage.spent[this.enforcedSource].usd.plus(usage.reserved);
      if (committed.plus(estimateUsd).greaterThan(limit)) return { allowed: false, reason: "LIMIT_REACHED" };
      await tx.aiBudgetReservation.create({
        data: {
          id: reservationId,
          companyId: company.id,
          apiSource: this.enforcedSource,
          amountUsd: estimateUsd,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });
      return { allowed: true };
    });
  }

  /** Remove a reserva (custo real gravado, erro ou execução abortada). Idempotente. */
  async release(reservationId: string, db: Db = this.prisma): Promise<void> {
    await db.aiBudgetReservation.deleteMany({ where: { id: reservationId } });
  }

  /** Nível do mês (sem valores): base dos avisos da empresa e do Super Admin. */
  async level(company: Pick<Company, "id" | "timezone">): Promise<AiUsageLevel> {
    const settings = await this.prisma.aiSettings.findUnique({ where: { companyId: company.id }, select: { monthlyLimitUsd: true } });
    const limit = settings?.monthlyLimitUsd ?? null;
    if (limit === null) return "NO_LIMIT";
    const usage = await this.monthUsage(company.id, company.timezone);
    return aiUsageLevel(usage.spent[this.enforcedSource].usd.toNumber(), limit.toNumber());
  }

  /** Visão completa (valores em USD): somente para o SUPERADMIN. */
  async view(company: Pick<Company, "id" | "timezone">): Promise<AiBudgetView> {
    const [settings, platform, usage] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { companyId: company.id }, select: { monthlyLimitUsd: true } }),
      this.prisma.platformSettings.findUnique({ where: { id: 1 }, select: { defaultAiMonthlyLimitUsd: true } }),
      this.monthUsage(company.id, company.timezone),
    ]);
    const limit = settings?.monthlyLimitUsd ?? null;
    const spent = usage.spent[this.enforcedSource].usd;
    return {
      month: usage.month,
      timezone: safeTimeZone(company.timezone),
      limitUsd: limit?.toFixed(2) ?? null,
      platformDefaultUsd: platform?.defaultAiMonthlyLimitUsd?.toFixed(2) ?? null,
      enforcedSource: this.enforcedSource,
      spentUsd: spent.toFixed(6),
      reservedUsd: usage.reserved.toFixed(6),
      percent: limit && limit.greaterThan(0) ? Math.floor(spent.dividedBy(limit).times(100).toNumber()) : null,
      level: aiUsageLevel(spent.toNumber(), limit?.toNumber() ?? null),
      bySource: (["OFFICIAL", "SIMULATED", "UNVERIFIED"] as const).map((source) => ({
        source,
        spentUsd: usage.spent[source].usd.toFixed(6),
        runs: usage.spent[source].runs,
      })),
    };
  }

  /**
   * Depois de gravar uma execução: registra a PRIMEIRA vez no mês em que o consumo atingiu 80% e 100% (um registro
   * por mês, origem e patamar; auditoria uma única vez). Os avisos das telas são calculados na hora; isto só evita
   * registros repetidos.
   */
  async recordThresholds(company: Pick<Company, "id" | "timezone">): Promise<void> {
    try {
      const settings = await this.prisma.aiSettings.findUnique({ where: { companyId: company.id }, select: { monthlyLimitUsd: true } });
      const limit = settings?.monthlyLimitUsd ?? null;
      if (limit === null) return;
      const usage = await this.monthUsage(company.id, company.timezone);
      const spent = usage.spent[this.enforcedSource].usd;
      for (const threshold of [AI_USAGE_NEAR_LIMIT_PERCENT, 100]) {
        if (spent.lessThan(limit.times(threshold).dividedBy(100))) continue;
        const inserted = await this.prisma.$executeRaw`
          INSERT INTO "AiUsageAlert" ("companyId", "month", "apiSource", "threshold")
          VALUES (${company.id}::uuid, ${usage.month}, ${this.enforcedSource}::"AiApiSource", ${threshold})
          ON CONFLICT DO NOTHING`;
        if (inserted > 0) {
          await this.audit.record({
            action: AUDIT_ACTIONS.AI_USAGE_THRESHOLD,
            actorUserId: null,
            entityType: "AiSettings",
            entityId: company.id,
            companyId: company.id,
            metadata: { month: usage.month, threshold, source: this.enforcedSource },
          });
        }
      }
    } catch (error) {
      // Registro auxiliar: uma falha aqui nunca derruba o atendimento.
      this.logger.warn(`Falha ao registrar alerta de consumo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
