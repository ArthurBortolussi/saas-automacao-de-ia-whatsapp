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

// ---------------------------------------------------------------- FASE 2

export const CONTACT_STATUSES = ["NEW", "LEAD", "QUALIFIED", "CUSTOMER", "LOST"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_SOURCES = ["MANUAL", "WHATSAPP", "WEBSITE", "REFERRAL", "SOCIAL", "OTHER"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONVERSATION_MODES = ["AI", "HUMAN", "PAUSED"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_SENDER_TYPES = ["CONTACT", "AGENT", "AI", "SYSTEM"] as const;
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];
