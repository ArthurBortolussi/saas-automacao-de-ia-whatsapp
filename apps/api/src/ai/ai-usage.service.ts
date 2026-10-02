import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type AiRun, type Company } from "@arthur-ai/database";
import {
  AI_RUN_RESULTS,
  PLATFORM_TIMEZONE,
  usageSourceOf,
  type AiRunItem,
  type AiRunResult,
  type AiUsageSummary,
  type AnalyticsPeriod,
} from "@arthur-ai/shared";
import { AnalyticsQueriesService } from "../analytics/analytics-queries.service.js";
import { periodInfo, resolveWindow } from "../analytics/period.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { priceFor } from "./pricing.js";

const RECENT_RUNS = 20;

function toRunItem(run: AiRun): AiRunItem {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    conversationId: run.conversationId,
    model: run.model,
    result: run.result,
    stopReason: run.stopReason,
    handoffReason: run.handoffReason,
    errorType: run.errorType,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheCreationInputTokens: run.cacheCreationInputTokens,
    cacheReadInputTokens: run.cacheReadInputTokens,
    costUsd: run.costUsd?.toFixed(6) ?? null,
    latencyMs: run.latencyMs,
    messageCount: run.messageCount,
    apiSource: usageSourceOf(run.apiSource),
  };
}

const decimal = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(6);

/**
 * Consumo da IA de UMA empresa, sempre filtrado pelo companyId validado pelo guard. Fase 6: mesmo período de
 * calendário e mesmo fuso (plataforma) do Analytics do SUPERADMIN, e a mesma separação por origem.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsQueriesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async summary(company: Company, period: AnalyticsPeriod): Promise<AiUsageSummary> {
    const window = await resolveWindow(this.prisma, period, PLATFORM_TIMEZONE, new Date());
    const { from, to, timezone } = window;
    const where: Prisma.AiRunWhereInput = { companyId: company.id, createdAt: { gte: from, lte: to } };

    const [totals, byResult, byModel, withoutUsage, withoutPrice, recent, daily, bySource] = await Promise.all([
      this.prisma.aiRun.aggregate({
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, cacheCreationInputTokens: true, cacheReadInputTokens: true, costUsd: true },
      }),
      this.prisma.aiRun.groupBy({ by: ["result"], where, _count: { _all: true } }),
      this.prisma.aiRun.groupBy({ by: ["model"], where, _count: { _all: true }, _sum: { costUsd: true }, orderBy: { model: "asc" } }),
      this.prisma.aiRun.count({ where: { ...where, inputTokens: null } }),
      this.prisma.aiRun.count({ where: { ...where, inputTokens: { not: null }, costUsd: null } }),
      this.prisma.aiRun.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: RECENT_RUNS }),
      // Dia no fuso da plataforma (o mesmo do Analytics); vai como parâmetro, nunca concatenado.
      this.prisma.$queryRaw<{ day: string; runs: bigint; cost: Prisma.Decimal | null }[]>`
        SELECT to_char("createdAt" AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "day",
               count(*) AS "runs", sum("costUsd") AS "cost"
          FROM "AiRun"
         WHERE "companyId" = ${company.id}::uuid AND "createdAt" >= ${from} AND "createdAt" <= ${to}
         GROUP BY 1 ORDER BY 1`,
      this.analytics.aiUsage(window, company.id),
    ]);

    const counts = Object.fromEntries(AI_RUN_RESULTS.map((result) => [result, 0])) as Record<AiRunResult, number>;
    for (const row of byResult) counts[row.result] = row._count._all;
    const price = priceFor(this.env.ai.model, this.env.ai.model, this.env.ai.priceOverride);

    return {
      period: periodInfo(window),
      runs: totals._count._all,
      byResult: counts,
      inputTokens: totals._sum.inputTokens ?? 0,
      outputTokens: totals._sum.outputTokens ?? 0,
      cacheCreationInputTokens: totals._sum.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: totals._sum.cacheReadInputTokens ?? 0,
      estimatedCostUsd: decimal(totals._sum.costUsd),
      runsWithoutUsage: withoutUsage,
      runsWithoutPrice: withoutPrice,
      byModel: byModel.map((row) => ({ model: row.model, runs: row._count._all, estimatedCostUsd: decimal(row._sum.costUsd) })),
      daily: daily.map((row) => ({ date: row.day, runs: Number(row.runs), estimatedCostUsd: decimal(row.cost) })),
      recent: recent.map(toRunItem),
      pricing: price ? { model: this.env.ai.model, ...price } : null,
      bySource,
    };
  }
}
