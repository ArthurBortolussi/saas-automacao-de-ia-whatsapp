// Espelham os enums do schema Prisma. A API tem uma checagem de tipos que falha no build
// se as duas definições divergirem (apps/api/src/common/enum-parity.ts).
export const GLOBAL_ROLES = ["SUPERADMIN", "USER"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const COMPANY_STATUSES = ["ONBOARDING", "ACTIVE", "PAUSED", "INACTIVE"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const MEMBER_ROLES = ["OWNER", "ADMIN", "AGENT"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type BrazilianState = (typeof BRAZILIAN_STATES)[number];
