import type {
  CompanyStatus,
  ContactSource,
  ContactStatus,
  ConversationMode,
  GlobalRole,
  MemberRole,
  UserStatus,
} from "@arthur-ai/shared";

export const COMPANY_STATUS_LABEL: Record<CompanyStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  INACTIVE: "Inativa",
};

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  AGENT: "Atendente",
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = { ACTIVE: "Ativo", INACTIVE: "Inativo" };
export const GLOBAL_ROLE_LABEL: Record<GlobalRole, string> = { SUPERADMIN: "Superadmin", USER: "Usuário" };

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatPhone(digits: string): string {
  const match = /^(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : digits;
}

export function formatCnpj(value: string): string {
  const match = /^(.{2})(.{3})(.{3})(.{4})(.{2})$/.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}/${match[4]}-${match[5]}` : value;
}

export function formatLocation(city: string | null, state: string | null): string {
  if (city && state) return `${city}/${state}`;
  return city ?? state ?? "—";
}

// ---------------------------------------------------------------- FASE 2

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  NEW: "Novo",
  LEAD: "Lead",
  QUALIFIED: "Qualificado",
  CUSTOMER: "Cliente",
  LOST: "Perdido",
};

export const CONTACT_SOURCE_LABEL: Record<ContactSource, string> = {
  MANUAL: "Manual",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Site",
  REFERRAL: "Indicação",
  SOCIAL: "Redes sociais",
  OTHER: "Outro",
};

export const CONVERSATION_MODE_LABEL: Record<ConversationMode, string> = {
  AI: "IA atendendo",
  HUMAN: "Humano atendendo",
  PAUSED: "Pausada",
};

const TIME_ZONE = "America/Sao_Paulo";
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIME_ZONE });
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

/** "14:32" se for hoje, "28/09" caso contrário (lista da inbox). */
export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return dayKeyFormatter.format(date) === dayKeyFormatter.format(now) ? timeFormatter.format(date) : shortDateFormatter.format(date);
}

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}
