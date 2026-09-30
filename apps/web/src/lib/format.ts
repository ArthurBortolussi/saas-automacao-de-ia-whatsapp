import type { CompanyStatus, GlobalRole, MemberRole, UserStatus } from "@arthur-ai/shared";

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
