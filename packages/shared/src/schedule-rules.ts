import { AI_TIME_PATTERN, isValidTimeZone } from "./ai-rules.js";
import type { ScheduleOverride } from "./enums.js";

// ---------------------------------------------------------------- FASE 7: horários, exceções e feriados

/**
 * Agenda semanal (horário geral do negócio, da IA ou da equipe). Horários são locais (HH:MM) no fuso da empresa.
 * Intervalos que viram a noite (ex.: 18:00–02:00) pertencem ao dia em que começam.
 */
export interface WeeklySchedule {
  alwaysOn: boolean;
  /** 0 = domingo ... 6 = sábado. */
  days: readonly number[];
  start: string;
  end: string;
}

/** Como uma data especial altera UMA agenda. */
export interface DayOverride {
  mode: ScheduleOverride;
  start: string | null;
  end: string | null;
}

/** Exceções de uma agenda por data local (YYYY-MM-DD). */
export type OverridesByDate = ReadonlyMap<string, DayOverride>;

export const SCHEDULE_KINDS = ["business", "ai", "team"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_KIND_LABEL: Record<ScheduleKind, string> = {
  business: "Horário geral do negócio",
  ai: "Horário da IA",
  team: "Horário da equipe",
};

const DAY_MINUTES = 1440;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function toMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Data de calendário válida (rejeita 2026-02-30). */
export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Soma dias a uma data pura (sem hora): aritmética em UTC, imune a horário de verão. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Data local, dia da semana e minuto do dia de um instante, no fuso informado. */
export function localDateTime(at: Date, timeZone: string): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: WEEKDAYS.indexOf(part("weekday")),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

/** [início, fim) em minutos a partir da meia-noite do dia; fim > 1440 quando vira a noite. Inválido → null (fechado). */
function toInterval(start: string | null, end: string | null): [number, number] | null {
  if (!start || !end || !AI_TIME_PATTERN.test(start) || !AI_TIME_PATTERN.test(end)) return null;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return null;
  return from < to ? [from, to] : [from, to + DAY_MINUTES];
}

/** Intervalo aberto que COMEÇA na data informada, considerando a exceção da data (ela prevalece sobre a semana). */
export function intervalOn(date: string, weekly: WeeklySchedule, overrides: OverridesByDate): [number, number] | null {
  const override = overrides.get(date);
  if (override?.mode === "CLOSED") return null;
  if (override?.mode === "CUSTOM") return toInterval(override.start, override.end);
  if (weekly.alwaysOn) return [0, DAY_MINUTES];
  return weekly.days.includes(weekdayOf(date)) ? toInterval(weekly.start, weekly.end) : null;
}

/**
 * A agenda está aberta neste instante? Considera o intervalo do dia e o que veio da noite anterior.
 * Fuso inválido: fechado (falha fechada, como o horário da IA da Fase 4).
 */
export function isOpenAt(weekly: WeeklySchedule, overrides: OverridesByDate, timeZone: string, at: Date = new Date()): boolean {
  if (!isValidTimeZone(timeZone)) return false;
  const { date, minutes } = localDateTime(at, timeZone);
  const today = intervalOn(date, weekly, overrides);
  if (today && minutes >= today[0] && minutes < today[1]) return true;
  const yesterday = intervalOn(addDays(date, -1), weekly, overrides);
  return Boolean(yesterday && yesterday[1] > DAY_MINUTES && minutes + DAY_MINUTES < yesterday[1]);
}

/** Até quantos dias para trás o início de um período fechado é procurado. */
const MAX_LOOKBACK_DAYS = 400;
export const NEVER_OPEN_PERIOD = "NUNCA_ABERTO";

/**
 * Identificador do período fechado contínuo que contém o instante (null se a agenda está aberta): a data e hora
 * LOCAIS em que a última abertura terminou (ex.: "2026-10-02T18:00"). Várias mensagens na mesma noite têm o mesmo
 * identificador; depois que a empresa abre e fecha de novo, o identificador muda. Sem abertura nos últimos 400 dias,
 * NUNCA_ABERTO (um único aviso).
 */
export function closedPeriodKey(weekly: WeeklySchedule, overrides: OverridesByDate, timeZone: string, at: Date = new Date()): string | null {
  if (!isValidTimeZone(timeZone)) return NEVER_OPEN_PERIOD;
  if (isOpenAt(weekly, overrides, timeZone, at)) return null;
  const { date, minutes } = localDateTime(at, timeZone);
  let best: number | null = null;
  for (let offset = 0; offset >= -MAX_LOOKBACK_DAYS; offset--) {
    // Nenhum intervalo que começa num dia mais antigo pode terminar depois do melhor já encontrado.
    if (best !== null && offset * DAY_MINUTES + 2 * DAY_MINUTES <= best) break;
    const interval = intervalOn(addDays(date, offset), weekly, overrides);
    if (!interval) continue;
    const end = offset * DAY_MINUTES + interval[1];
    if (end <= minutes && (best === null || end > best)) best = end;
  }
  if (best === null) return NEVER_OPEN_PERIOD;
  const dayOffset = Math.floor(best / DAY_MINUTES);
  const minute = best - dayOffset * DAY_MINUTES;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${addDays(date, dayOffset)}T${hh}:${mm}`;
}

// ---------------------------------------------------------------- feriados nacionais

export interface NationalHoliday {
  date: string;
  name: string;
}

/** Domingo de Páscoa (algoritmo gregoriano anônimo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const HOLIDAY_YEAR_MIN = 2000;
export const HOLIDAY_YEAR_MAX = 2100;

/**
 * Feriados NACIONAIS do Brasil, calculados localmente (sem API externa), conforme o calendário anual do governo
 * federal (Portaria MGI de feriados e pontos facultativos): Confraternização Universal, Paixão de Cristo (móvel:
 * sexta-feira antes da Páscoa), Tiradentes, Dia do Trabalho, Independência, Nossa Senhora Aparecida, Finados,
 * Proclamação da República, Dia Nacional de Zumbi e da Consciência Negra (nacional desde 2024, Lei 14.759/2023) e
 * Natal. Pontos facultativos (Carnaval, Quarta-feira de Cinzas, Corpus Christi, vésperas) e feriados estaduais ou
 * municipais NÃO entram: a empresa os cadastra como datas especiais. São só referência: nunca fecham a empresa.
 */
export function brazilianNationalHolidays(year: number): NationalHoliday[] {
  if (!Number.isInteger(year) || year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return [];
  const fixed = (monthDay: string, name: string): NationalHoliday => ({ date: `${year}-${monthDay}`, name });
  const holidays: NationalHoliday[] = [
    fixed("01-01", "Confraternização Universal"),
    { date: addDays(easterSunday(year), -2), name: "Paixão de Cristo (Sexta-feira Santa)" },
    fixed("04-21", "Tiradentes"),
    fixed("05-01", "Dia do Trabalho"),
    fixed("09-07", "Independência do Brasil"),
    fixed("10-12", "Nossa Senhora Aparecida"),
    fixed("11-02", "Finados"),
    fixed("11-15", "Proclamação da República"),
    fixed("12-25", "Natal"),
  ];
  if (year >= 2024) holidays.push(fixed("11-20", "Dia Nacional de Zumbi e da Consciência Negra"));
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- mensagens automáticas e fila

export const DEFAULT_WELCOME_MESSAGE =
  "Olá! Seja bem-vindo(a). Recebemos sua mensagem e vamos dar continuidade ao seu atendimento por aqui.";
export const DEFAULT_AFTER_HOURS_MESSAGE =
  "Olá! No momento estamos fora do nosso horário de atendimento. Sua mensagem foi recebida e retornaremos assim que possível.";
export const DEFAULT_CLOSING_MESSAGE =
  "Seu atendimento foi finalizado. Obrigado pelo contato! Se precisar de algo mais, é só enviar uma nova mensagem.";
export const AUTO_MESSAGE_MAX_LENGTH = 1000;

export const AUTO_MESSAGE_KINDS = ["welcome", "queueNotice", "afterHours", "closing"] as const;
export type AutoMessageKind = (typeof AUTO_MESSAGE_KINDS)[number];

export const AUTO_MESSAGE_LABEL: Record<AutoMessageKind, string> = {
  welcome: "Boas-vindas",
  queueNotice: "Espera na fila",
  afterHours: "Atendimento fora do expediente",
  closing: "Encerramento",
};

export const DEFAULT_MAX_QUEUE_WAIT_MINUTES = 30;
export const MAX_QUEUE_WAIT_LIMIT_MINUTES = 1440;

/**
 * Espera excessiva na fila: tempo de RELÓGIO desde a entrada atual na fila (Conversation.queuedAt), inclusive fora
 * do expediente da equipe. Difere da "espera na fila" do Analytics (Fase 6), que soma esperas concluídas por
 * atribuição desde a primeira entrada do ciclo.
 */
export function isQueueOverdue(queuedAt: Date | string | null, maxMinutes: number, now: Date = new Date()): boolean {
  if (!queuedAt) return false;
  return now.getTime() - new Date(queuedAt).getTime() > maxMinutes * 60_000;
}
