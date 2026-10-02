/** Usada quando a empresa não personalizou a mensagem de passagem para humano. */
export const DEFAULT_HANDOFF_MESSAGE =
  "Vou encaminhar seu atendimento para um de nossos atendentes. Assim que possível, alguém continuará a conversa.";

export const DEFAULT_AI_TIMEZONE = "America/Sao_Paulo";

/** Limites da base de conhecimento por empresa. */
export const KNOWLEDGE_TITLE_MAX = 160;
export const KNOWLEDGE_CONTENT_MAX = 10_000;
export const KNOWLEDGE_MAX_ENTRIES = 500;

export const AI_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AiSchedule {
  alwaysOn: boolean;
  timezone: string;
  /** 0 = domingo ... 6 = sábado. */
  scheduleDays: readonly number[];
  scheduleStart: string;
  scheduleEnd: string;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Dia da semana (0-6) e minuto do dia no fuso informado. */
function localTime(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(part("weekday")), minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

/**
 * Horário em que a IA pode responder (não confundir com o horário de funcionamento da empresa).
 * Intervalos que viram a noite (ex.: 18:00–08:00) pertencem ao dia em que começam.
 * Fuso inválido ou início igual ao fim: a IA não responde (falha fechada).
 */
export function isWithinAiSchedule(schedule: AiSchedule, now: Date = new Date()): boolean {
  if (schedule.alwaysOn) return true;
  if (!isValidTimeZone(schedule.timezone)) return false;
  if (!AI_TIME_PATTERN.test(schedule.scheduleStart) || !AI_TIME_PATTERN.test(schedule.scheduleEnd)) return false;
  const start = toMinutes(schedule.scheduleStart);
  const end = toMinutes(schedule.scheduleEnd);
  if (start === end) return false;
  const { weekday, minutes } = localTime(now, schedule.timezone);
  const days = new Set(schedule.scheduleDays);
  if (start < end) return days.has(weekday) && minutes >= start && minutes < end;
  const previousDay = (weekday + 6) % 7;
  return (days.has(weekday) && minutes >= start) || (days.has(previousDay) && minutes < end);
}
