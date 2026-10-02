import { BadRequestException } from "@nestjs/common";
import {
  ANALYTICS_MAX_REFERENCE_AGE_MS,
  ANALYTICS_PERIOD_DAYS,
  ANALYTICS_PERIOD_LABEL,
  isValidTimeZone,
  PLATFORM_TIMEZONE,
  type AnalyticsPeriod,
  type AnalyticsPeriodInfo,
} from "@arthur-ai/shared";
import type { PrismaService } from "../prisma/prisma.service.js";

/** Recorte de tempo de um relatório: [from, to], com `to` = instante de referência. */
export interface ReportWindow {
  period: AnalyticsPeriod;
  timezone: string;
  from: Date;
  to: Date;
  days: string[];
}

// Pequena tolerância para relógios levemente adiantados no navegador.
const FUTURE_TOLERANCE_MS = 60_000;

/** Instante de referência: o informado (refazer o mesmo recorte, ex.: exportação) ou agora. */
export function referenceInstant(at: string | undefined, now = new Date()): Date {
  if (!at) return now;
  const value = new Date(at);
  const age = now.getTime() - value.getTime();
  if (Number.isNaN(value.getTime()) || age < -FUTURE_TOLERANCE_MS || age > ANALYTICS_MAX_REFERENCE_AGE_MS) {
    throw new BadRequestException("Instante de referência fora do intervalo permitido. Atualize o relatório e tente de novo.");
  }
  return value.getTime() > now.getTime() ? now : value;
}

/** Fuso válido ou o padrão da plataforma (um valor inválido no banco nunca quebra o relatório). */
export function safeTimeZone(timezone: string | null | undefined): string {
  return timezone && isValidTimeZone(timezone) ? timezone : PLATFORM_TIMEZONE;
}

/**
 * Início do primeiro dia do período no fuso informado. O PostgreSQL faz a conversão: a subtração de dias
 * acontece no calendário LOCAL, então dias com mudança de horário (23 h ou 25 h) continuam corretos.
 */
export async function resolveWindow(prisma: PrismaService, period: AnalyticsPeriod, timezone: string, to: Date): Promise<ReportWindow> {
  const span = ANALYTICS_PERIOD_DAYS[period];
  const [row] = await prisma.$queryRaw<{ from: Date; today: string }[]>`
    SELECT ((date_trunc('day', ${to}::timestamptz AT TIME ZONE ${timezone}) - make_interval(days => ${span - 1}::int))
             AT TIME ZONE ${timezone}) AS "from",
           to_char(${to}::timestamptz AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "today"`;
  if (!row) throw new Error("Falha ao calcular o período.");
  // Datas puras (sem hora): aritmética em UTC não sofre com horário de verão.
  const today = new Date(`${row.today}T00:00:00Z`);
  const days = Array.from({ length: span }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (span - 1 - index));
    return day.toISOString().slice(0, 10);
  });
  return { period, timezone, from: row.from, to, days };
}

export function periodInfo(window: ReportWindow): AnalyticsPeriodInfo {
  return {
    period: window.period,
    label: ANALYTICS_PERIOD_LABEL[window.period],
    timezone: window.timezone,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    days: window.days,
  };
}
