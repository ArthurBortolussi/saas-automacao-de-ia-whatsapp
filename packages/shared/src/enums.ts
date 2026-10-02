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

// ---------------------------------------------------------------- FASE 3

export const CONVERSATION_CHANNELS = ["INTERNAL", "WHATSAPP"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const MESSAGE_DELIVERY_STATUSES = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export const WHATSAPP_ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "ERROR", "DISABLED"] as const;
export type WhatsAppAccountStatus = (typeof WHATSAPP_ACCOUNT_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = ["PENDING", "PROCESSED", "IGNORED", "FAILED"] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

// ---------------------------------------------------------------- FASE 4

export const AI_TONES = ["FORMAL", "PROFESSIONAL", "FRIENDLY"] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_HANDOFF_REASONS = [
  "CUSTOMER_REQUEST",
  "MISSING_INFORMATION",
  "MODEL_REFUSAL",
  "INCOMPLETE_RESPONSE",
  "AI_ERROR",
  "UNSUPPORTED_CONTENT",
  "CONVERSATION_LIMIT",
] as const;
export type AiHandoffReason = (typeof AI_HANDOFF_REASONS)[number];

export const AI_TASK_STATUSES = ["PENDING", "RUNNING", "DONE", "SKIPPED", "CANCELED", "FAILED"] as const;
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

export const AI_RUN_RESULTS = ["REPLIED", "HANDOFF", "DISCARDED", "ERROR"] as const;
export type AiRunResult = (typeof AI_RUN_RESULTS)[number];

// ---------------------------------------------------------------- FASE 5

/** Disponibilidade do funcionário (escolhida por ele). */
export const AGENT_AVAILABILITIES = ["AVAILABLE", "BUSY", "AWAY"] as const;
export type AgentAvailability = (typeof AGENT_AVAILABILITIES)[number];

/** Estado operacional da conversa (independente do modo AI/HUMAN/PAUSED). */
export const CONVERSATION_STATUSES = ["OPEN", "QUEUED", "ASSIGNED", "CLOSED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_CLOSE_REASONS = ["MANUAL", "INACTIVITY"] as const;
export type ConversationCloseReason = (typeof CONVERSATION_CLOSE_REASONS)[number];

export const ASSIGNMENT_START_REASONS = ["AUTO", "TRANSFER", "ASSUME", "CREATED"] as const;
export type AssignmentStartReason = (typeof ASSIGNMENT_START_REASONS)[number];

export const ASSIGNMENT_END_REASONS = ["TRANSFERRED", "CLOSED", "RETURNED_TO_AI", "REQUEUED"] as const;
export type AssignmentEndReason = (typeof ASSIGNMENT_END_REASONS)[number];

// ---------------------------------------------------------------- FASE 6

/** Para onde a execução da IA foi enviada (gravado na execução; nulo = registro antigo, origem não verificada). */
export const AI_API_SOURCES = ["OFFICIAL", "SIMULATED"] as const;
export type AiApiSource = (typeof AI_API_SOURCES)[number];

/** Como um ciclo de atendimento começou (BACKFILL = reconstruído a partir de dados anteriores à Fase 6). */
export const CYCLE_ORIGINS = ["NEW_CONVERSATION", "REOPENED", "BACKFILL"] as const;
export type CycleOrigin = (typeof CYCLE_ORIGINS)[number];
