import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type AiRun, type Company } from "@arthur-ai/database";
import { AI_RUN_RESULTS, type AiRunItem, type AiRunResult, type AiUsageSummary } from "@arthur-ai/shared";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiSettingsService } from "./ai-settings.service.js";
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
  };
}

const decimal = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(6);

/** Consumo da IA de UMA empresa, sempre filtrado pelo companyId validado pelo guard. */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async summary(company: Company, days: number): Promise<AiUsageSummary> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const where: Prisma.AiRunWhereInput = { companyId: company.id, createdAt: { gte: from, lte: to } };
    const { timezone } = await this.settings.resolve(company.id);

    const [totals, byResult, byModel, withoutUsage, withoutPrice, recent, daily] = await Promise.all([
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
      // Dia no fuso da empresa (o fuso vem do banco já validado; vai como parâmetro, nunca concatenado).
      this.prisma.$queryRaw<{ day: string; runs: bigint; cost: Prisma.Decimal | null }[]>`
        SELECT to_char("createdAt" AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "day",
               count(*) AS "runs", sum("costUsd") AS "cost"
          FROM "AiRun"
         WHERE "companyId" = ${company.id}::uuid AND "createdAt" >= ${from} AND "createdAt" <= ${to}
         GROUP BY 1 ORDER BY 1`,
    ]);

    const counts = Object.fromEntries(AI_RUN_RESULTS.map((result) => [result, 0])) as Record<AiRunResult, number>;
    for (const row of byResult) counts[row.result] = row._count._all;
    const price = priceFor(this.env.ai.model, this.env.ai.model, this.env.ai.priceOverride);

    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
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
    };
  }
}
