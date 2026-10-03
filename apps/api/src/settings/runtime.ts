import type { Prisma, ScheduleException } from "@arthur-ai/database";
import {
  addDays,
  closedPeriodKey,
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_CLOSING_MESSAGE,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_MAX_QUEUE_WAIT_MINUTES,
  DEFAULT_WELCOME_MESSAGE,
  isCompanyBlocked,
  isOpenAt,
  localDateTime,
  QUEUE_WAITING_MESSAGE,
  type AutoMessageKind,
  type DayOverride,
  type ScheduleKind,
  type WeeklySchedule,
} from "@arthur-ai/shared";
import { safeTimeZone } from "../analytics/period.js";

/**
 * FASE 7: leitura das configurações operacionais de uma empresa (horários, exceções, mensagens, fila, pausa da IA)
 * para os fluxos de recebimento, distribuição, IA e envio. Funções puras sobre um client do Prisma (como o
 * cycle-tracker): podem rodar dentro das transações existentes, sem dependências entre módulos.
 */

type Db = Prisma.TransactionClient;

export interface AutoMessageConfig {
  enabled: boolean;
  text: string;
}

export interface CompanyRuntime {
  companyId: string;
  timezone: string;
  schedules: Record<ScheduleKind, WeeklySchedule>;
  overrides: Record<ScheduleKind, Map<string, DayOverride>>;
  messages: Record<AutoMessageKind, AutoMessageConfig>;
  maxQueueWaitMinutes: number;
  inactivityTimeoutMinutes: number;
  aiPaused: boolean;
}

/** Exceções passadas consideradas na busca do início de um período fechado (ver closedPeriodKey). */
const LOOKBACK_DAYS = 401;

export const DEFAULT_BUSINESS_SCHEDULE: WeeklySchedule = { alwaysOn: false, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
// Equipe 24 h por padrão: empresas existentes continuam com a distribuição da Fase 5 a qualquer hora.
export const DEFAULT_TEAM_SCHEDULE: WeeklySchedule = { alwaysOn: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
export const DEFAULT_AI_SCHEDULE: WeeklySchedule = { alwaysOn: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };

export const DEFAULT_AUTO_MESSAGES: Record<AutoMessageKind, string> = {
  welcome: DEFAULT_WELCOME_MESSAGE,
  queueNotice: QUEUE_WAITING_MESSAGE,
  afterHours: DEFAULT_AFTER_HOURS_MESSAGE,
  closing: DEFAULT_CLOSING_MESSAGE,
};

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function override(mode: ScheduleException["businessMode"], start: string | null, end: string | null): DayOverride {
  return { mode, start, end };
}

export async function loadCompanyRuntime(db: Db, companyId: string, now: Date = new Date()): Promise<CompanyRuntime> {
  // Sequencial de propósito: dentro de uma transação, consultas paralelas disputariam a mesma conexão.
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  const settings = await db.companySettings.findUnique({ where: { companyId } });
  const team = await db.teamSettings.findUnique({ where: { companyId } });
  const ai = await db.aiSettings.findUnique({
    where: { companyId },
    select: { alwaysOn: true, scheduleDays: true, scheduleStart: true, scheduleEnd: true, pausedAt: true },
  });
  const timezone = safeTimeZone(company.timezone);
  const today = localDateTime(now, timezone).date;
  const exceptions = await db.scheduleException.findMany({
    where: { companyId, date: { gte: new Date(`${addDays(today, -LOOKBACK_DAYS)}T00:00:00Z`), lte: new Date(`${addDays(today, 1)}T00:00:00Z`) } },
  });
  const overrides: CompanyRuntime["overrides"] = { business: new Map(), ai: new Map(), team: new Map() };
  for (const row of exceptions) {
    const date = dateKey(row.date);
    overrides.business.set(date, override(row.businessMode, row.businessStart, row.businessEnd));
    overrides.ai.set(date, override(row.aiMode, row.aiStart, row.aiEnd));
    overrides.team.set(date, override(row.teamMode, row.teamStart, row.teamEnd));
  }
  const message = (enabled: boolean, text: string | null, kind: AutoMessageKind): AutoMessageConfig => ({
    enabled,
    text: text ?? DEFAULT_AUTO_MESSAGES[kind],
  });
  return {
    companyId,
    timezone,
    schedules: {
      business: settings
        ? { alwaysOn: settings.businessAlwaysOpen, days: settings.businessDays, start: settings.businessStart, end: settings.businessEnd }
        : DEFAULT_BUSINESS_SCHEDULE,
      team: team ? { alwaysOn: team.teamAlwaysOn, days: team.teamDays, start: team.teamStart, end: team.teamEnd } : DEFAULT_TEAM_SCHEDULE,
      ai: ai ? { alwaysOn: ai.alwaysOn, days: ai.scheduleDays, start: ai.scheduleStart, end: ai.scheduleEnd } : DEFAULT_AI_SCHEDULE,
    },
    overrides,
    messages: {
      welcome: message(settings?.welcomeEnabled ?? false, settings?.welcomeMessage ?? null, "welcome"),
      queueNotice: message(settings?.queueNoticeEnabled ?? true, settings?.queueNoticeMessage ?? null, "queueNotice"),
      afterHours: message(settings?.afterHoursEnabled ?? false, settings?.afterHoursMessage ?? null, "afterHours"),
      closing: message(settings?.closingEnabled ?? false, settings?.closingMessage ?? null, "closing"),
    },
    maxQueueWaitMinutes: team?.maxQueueWaitMinutes ?? DEFAULT_MAX_QUEUE_WAIT_MINUTES,
    inactivityTimeoutMinutes: team?.inactivityTimeoutMinutes ?? DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
    aiPaused: Boolean(ai?.pausedAt),
  };
}

export function isScheduleOpen(runtime: CompanyRuntime, kind: ScheduleKind, at: Date = new Date()): boolean {
  return isOpenAt(runtime.schedules[kind], runtime.overrides[kind], runtime.timezone, at);
}

/** Identificador do período fechado do horário GERAL do negócio (null = aberto). */
export function businessClosedPeriod(runtime: CompanyRuntime, at: Date = new Date()): string | null {
  return closedPeriodKey(runtime.schedules.business, runtime.overrides.business, runtime.timezone, at);
}

/**
 * Situação da empresa lida com FOR SHARE: uma suspensão concorrente (UPDATE na linha da empresa) espera esta
 * transação terminar, ou esta transação já enxerga a empresa suspensa. É a barreira entre a suspensão e os fluxos
 * de recebimento, distribuição e envio.
 */
export async function companyBlockedForShare(tx: Db, companyId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "Company" WHERE "id" = ${companyId}::uuid FOR SHARE`;
  return !row || isCompanyBlocked(row.status);
}
