import { z } from "zod";
import type { AiApiSource, CompanyStatus } from "./enums.js";

// ---------------------------------------------------------------- FASE 6: Analytics e relatórios

/**
 * Períodos de calendário, sempre incluindo o dia atual (no fuso do relatório):
 * today = início do dia de hoje até o instante de referência; last7days = hoje + 6 dias anteriores;
 * last30days = hoje + 29 dias anteriores.
 */
export const ANALYTICS_PERIODS = ["today", "last7days", "last30days"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const ANALYTICS_PERIOD_DAYS: Record<AnalyticsPeriod, number> = { today: 1, last7days: 7, last30days: 30 };
export const ANALYTICS_PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
  today: "Hoje",
  last7days: "Últimos 7 dias",
  last30days: "Últimos 30 dias",
};
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = "last7days";

/** Fuso de referência dos relatórios consolidados da plataforma (Super Admin) e padrão das empresas. */
export const PLATFORM_TIMEZONE = "America/Sao_Paulo";

/** Até quanto tempo atrás um instante de referência (`at`) é aceito: refazer a tela ou exportar o mesmo recorte. */
export const ANALYTICS_MAX_REFERENCE_AGE_MS = 24 * 60 * 60 * 1000;

export const EXPORT_FORMATS = ["pdf", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const strict = z.strictObject;

export const analyticsQuerySchema = strict({
  period: z.enum(ANALYTICS_PERIODS, { error: "Período inválido." }).default(DEFAULT_ANALYTICS_PERIOD),
  // Instante de referência devolvido por um relatório anterior: a exportação usa exatamente o mesmo recorte.
  at: z.iso.datetime({ offset: true, error: "Instante de referência inválido." }).optional(),
});
export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

export const analyticsExportQuerySchema = strict({
  ...analyticsQuerySchema.shape,
  format: z.enum(EXPORT_FORMATS, { error: "Formato inválido. Use pdf ou xlsx." }),
});
export type AnalyticsExportQuery = z.output<typeof analyticsExportQuerySchema>;

export interface AnalyticsPeriodInfo {
  period: AnalyticsPeriod;
  label: string;
  timezone: string;
  /** Início do primeiro dia (inclusivo). */
  from: string;
  /** Instante de referência (inclusivo): fim do recorte. */
  to: string;
  /** Dias de calendário do período (YYYY-MM-DD, no fuso). */
  days: string[];
}

/** Média de uma duração: null quando não há amostras (a tela mostra "Sem dados", nunca zero). */
export interface DurationStat {
  averageSeconds: number | null;
  samples: number;
}

/**
 * Atendimentos (ciclos) INICIADOS no período, classificados pelo histórico até o instante de referência.
 * Categorias mutuamente exclusivas: aiOnlyClosed + aiOnlyOpen + withHuman + awaitingHuman + withoutResponse = started.
 */
export interface CycleBreakdown {
  started: number;
  /** Passou pela IA, sem transferência e sem participação humana, e já foi encerrado. */
  aiOnlyClosed: number;
  /** Passou pela IA, sem transferência e sem participação humana, ainda em andamento. */
  aiOnlyOpen: number;
  /** Teve participação efetiva de pelo menos um funcionário (atribuição ou mensagem). */
  withHuman: number;
  /** Entrou na fila humana (pedido ou transferência) e ainda não teve participação de funcionário. */
  awaitingHuman: number;
  /** Nem a IA nem a equipe responderam (ex.: IA desligada, fora do horário, conversa pausada). */
  withoutResponse: number;
  /** Atendimentos transferidos pela IA para humano (cada atendimento conta uma vez). */
  aiTransferred: number;
  /** Atendimentos reconstruídos de dados anteriores à Fase 6 (tempos não calculados). */
  reconstructed: number;
}

export interface ClosedBreakdown {
  /** Atendimentos encerrados no período (pelo horário do encerramento). */
  total: number;
  manual: number;
  inactivity: number;
  /** Destes, quantos tiveram participação humana. */
  withHuman: number;
}

/** Situação AGORA (no momento da consulta), independente do período. */
export interface CurrentSituation {
  asOf: string;
  inProgress: number;
  withAi: number;
  queued: number;
  withAgent: number;
  /** Pausadas ou humanas antigas sem responsável. */
  other: number;
}

export interface TeamSummary {
  /** Atendimentos iniciados no período com participação humana. */
  humanCycles: number;
  /** Atendimentos com participação humana encerrados no período. */
  humanClosed: number;
  /** Conversas com funcionário agora. */
  humanInProgress: number;
  firstResponse: DurationStat;
  /** Pedidos de atendimento humano ainda sem resposta de funcionário (dos iniciados no período). */
  withoutHumanReply: number;
  queueWait: DurationStat;
}

export interface DailyPoint {
  date: string;
  started: number;
  aiOnly: number;
  withHuman: number;
  closed: number;
}

/** Relatório da EMPRESA (OWNER/ADMIN). Não tem e nunca deve ter dados financeiros ou de consumo da IA. */
export interface CompanyAnalyticsReport {
  scope: "company";
  company: { id: string; name: string };
  generatedAt: string;
  period: AnalyticsPeriodInfo;
  cycles: CycleBreakdown;
  closed: ClosedBreakdown;
  current: CurrentSituation;
  team: TeamSummary;
  daily: DailyPoint[];
}

/** Origem do consumo da IA. UNVERIFIED = registros anteriores à Fase 6 (origem não registrada). */
export const AI_USAGE_SOURCES = ["OFFICIAL", "SIMULATED", "UNVERIFIED"] as const;
export type AiUsageSource = (typeof AI_USAGE_SOURCES)[number];
export const AI_USAGE_SOURCE_LABEL: Record<AiUsageSource, string> = {
  OFFICIAL: "API oficial da Anthropic",
  SIMULATED: "Simulador (não é custo real)",
  UNVERIFIED: "Origem não verificada",
};
export function usageSourceOf(apiSource: AiApiSource | null): AiUsageSource {
  return apiSource ?? "UNVERIFIED";
}

export interface AiUsageBucket {
  source: AiUsageSource;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Soma das estimativas (string decimal, USD). */
  estimatedCostUsd: string;
  /** Execuções sem custo estimado (sem consumo informado ou sem preço): fora da soma. */
  runsWithoutCost: number;
  /** Atendimentos distintos com custo conhecido (base da média). */
  cyclesWithCost: number;
  /** Custo médio por atendimento que usou a IA; null quando não há base de cálculo. */
  averageCostPerCycleUsd: string | null;
}

export interface AiUsageTotals {
  currency: "USD";
  bySource: AiUsageBucket[];
}

export interface CompanyUsageRow {
  companyId: string;
  name: string;
  status: CompanyStatus;
  cyclesStarted: number;
  aiRuns: number;
  totalTokens: number;
  costOfficialUsd: string;
  /** Simulado + origem não verificada: nunca somado ao custo oficial. */
  costNotOfficialUsd: string;
}

export interface MessageVolume {
  inbound: number;
  outboundAi: number;
  outboundAgent: number;
  outboundSystem: number;
  /** Enviadas que falharam (já incluídas nas contagens acima). */
  outboundFailed: number;
}

/** Relatório da PLATAFORMA (somente SUPERADMIN). */
export interface PlatformAnalyticsReport {
  scope: "platform";
  generatedAt: string;
  period: AnalyticsPeriodInfo;
  companies: { total: number; withActivity: number };
  cycles: CycleBreakdown;
  closed: ClosedBreakdown;
  current: CurrentSituation;
  team: TeamSummary;
  messages: MessageVolume;
  daily: DailyPoint[];
  ai: AiUsageTotals;
  byCompany: CompanyUsageRow[];
}

/** Indicadores de UMA empresa vistos pelo SUPERADMIN (fuso da plataforma, igual à tabela por empresa). */
export interface AdminCompanyAnalytics {
  scope: "admin-company";
  company: { id: string; name: string; status: CompanyStatus };
  generatedAt: string;
  period: AnalyticsPeriodInfo;
  cycles: CycleBreakdown;
  closed: ClosedBreakdown;
  current: CurrentSituation;
  team: TeamSummary;
  messages: MessageVolume;
  daily: DailyPoint[];
  ai: AiUsageTotals;
}

/** Duração legível em português ("Sem dados" quando não há amostra). */
export function formatDurationPt(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Sem dados";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
}

/** Percentual inteiro de uma parte (null quando o total é zero). */
export function sharePercent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}
