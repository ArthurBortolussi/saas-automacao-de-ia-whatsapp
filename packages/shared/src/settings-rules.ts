import type { MemberRole, SettingsPermission } from "./enums.js";

// ---------------------------------------------------------------- FASE 7: permissões, consumo e suporte

export const SETTINGS_PERMISSION_LABEL: Record<SettingsPermission, string> = {
  AI: "Configurações da IA",
  SERVICE: "Atendimento e fila",
  SCHEDULE: "Horários e exceções",
  MESSAGES: "Mensagens automáticas",
};

export const SETTINGS_PERMISSION_HINT: Record<SettingsPermission, string> = {
  AI: "Nome, tom, orientações, mensagem de transferência, encerramento automático e pausa da IA.",
  SERVICE: "Tempo máximo de espera na fila e encerramento por inatividade da equipe.",
  SCHEDULE: "Horário geral, horário da IA, horário da equipe, feriados e datas especiais.",
  MESSAGES: "Boas-vindas, espera na fila, fora do expediente e encerramento.",
};

/**
 * Pode editar este grupo de configurações? O proprietário edita tudo; administradores e funcionários só os grupos
 * concedidos individualmente. O SUPERADMIN é tratado à parte, no backend.
 */
export function memberHasSettingsPermission(
  member: { role: MemberRole; settingsPermissions: readonly SettingsPermission[] } | null,
  permission: SettingsPermission,
): boolean {
  if (!member) return false;
  return member.role === "OWNER" || member.settingsPermissions.includes(permission);
}

/** Situação do consumo mensal da IA. NO_LIMIT = empresa sem limite configurado. */
export const AI_USAGE_LEVELS = ["NO_LIMIT", "OK", "NEAR_LIMIT", "LIMIT_REACHED"] as const;
export type AiUsageLevel = (typeof AI_USAGE_LEVELS)[number];

export const AI_USAGE_NEAR_LIMIT_PERCENT = 80;

/** Nível a partir do consumo e do limite (em USD, strings decimais ou números). */
export function aiUsageLevel(spent: number, limit: number | null): AiUsageLevel {
  if (limit === null) return "NO_LIMIT";
  if (spent >= limit) return "LIMIT_REACHED";
  if (spent >= (limit * AI_USAGE_NEAR_LIMIT_PERCENT) / 100) return "NEAR_LIMIT";
  return "OK";
}

/** Link seguro para o WhatsApp de suporte (só dígitos; nunca texto livre na URL). */
export function supportWhatsAppUrl(digits: string | null): string | null {
  return digits && /^\d{10,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

export function supportEmailUrl(email: string | null): string | null {
  return email ? `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}` : null;
}

/** Empresa suspensa (Fase 7) ou com acesso bloqueado por status (Fase 1). */
export function isCompanyBlocked(status: string): boolean {
  return status === "PAUSED" || status === "INACTIVE";
}
