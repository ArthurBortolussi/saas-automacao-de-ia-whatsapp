import type { AiUsageBucket, AiUsageSource, AnalyticsPeriodInfo } from "./analytics.js";
import type {
  CompanyStatus,
  ContactSource,
  ContactStatus,
  ConversationChannel,
  ConversationMode,
  GlobalRole,
  MessageDeliveryStatus,
  WhatsAppAccountStatus,
  MemberRole,
  MessageDirection,
  MessageSenderType,
  UserStatus,
  AiHandoffReason,
  AiRunResult,
  AiTone,
  AgentAvailability,
  ConversationCloseReason,
  ConversationStatus,
} from "./enums.js";

// Formatos de resposta da API. Datas trafegam como string ISO.

// Códigos de erro que o frontend trata de forma específica.
export const API_ERROR_CODES = {
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  COMPANY_SUSPENDED: "COMPANY_SUSPENDED",
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  code?: ApiErrorCode;
  details?: { path: string; message: string }[];
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    globalRole: GlobalRole;
    mustChangePassword: boolean;
  };
  membership: {
    role: MemberRole;
    company: { id: string; name: string; slug: string; status: CompanyStatus };
    /** Fase 5: disponibilidade atual do funcionário (para o seletor do painel). */
    availability: AgentAvailability;
  } | null;
}

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: CompanyStatus;
  city: string | null;
  state: string | null;
  createdAt: string;
}

export interface CompanyDetail extends CompanySummary {
  legalName: string | null;
  cnpj: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  address: string | null;
  businessHours: string | null;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminDashboardResponse {
  totals: {
    companies: number;
    activeCompanies: number;
    onboardingCompanies: number;
    users: number;
  };
  recentCompanies: CompanySummary[];
}

export interface CompanyMemberItem {
  id: string;
  role: MemberRole;
  createdAt: string;
  user: { id: string; name: string; email: string; status: UserStatus; mustChangePassword: boolean };
}

export interface AdminUserItem {
  id: string;
  name: string;
  email: string;
  globalRole: GlobalRole;
  status: UserStatus;
  createdAt: string;
  company: { id: string; name: string; role: MemberRole } | null;
}

// Com Secure, o prefixo __Host- obriga também Path=/ e ausência de Domain (cookie preso ao host).
// API e web derivam o nome da MESMA variável (SESSION_COOKIE_SECURE) para nunca divergirem.
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-aai_session" : "aai_session";
}

/** Interpreta SESSION_COOKIE_SECURE; sem valor, segue o NODE_ENV do processo. */
export function parseCookieSecure(value: string | undefined, nodeEnv: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return nodeEnv === "production";
}

// ---------------------------------------------------------------- FASE 2

export interface ContactSummary {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: ContactStatus;
  source: ContactSource;
  createdAt: string;
}

export interface ContactDetail extends ContactSummary {
  notes: string | null;
  updatedAt: string;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface ConversationSummary {
  id: string;
  channel: ConversationChannel;
  mode: ConversationMode;
  /** Fase 5: estado operacional (fila, atribuída, encerrada). */
  status: ConversationStatus;
  queuedAt: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  contact: { id: string; name: string; phone: string; status: ContactStatus };
  assignedUser: UserRef | null;
}

export interface ConversationDetail extends Omit<ConversationSummary, "contact"> {
  contact: ContactDetail;
  aiMayReply: boolean;
  humanMayReply: boolean;
  /** WhatsApp: última mensagem do cliente e se a janela de 24h está aberta. */
  lastInboundAt: string | null;
  serviceWindowOpen: boolean;
  /** Última passagem automática da IA para humano (motivo), se houver. */
  aiHandoffReason: AiHandoffReason | null;
  aiHandoffAt: string | null;
  /** Fase 5: posição na fila da empresa (1 = próxima), quando QUEUED. */
  queuePosition: number | null;
  assignedAt: string | null;
  closedAt: string | null;
  closeReason: ConversationCloseReason | null;
  lastActivityAt: string | null;
  /** O que o usuário atual pode fazer nesta conversa (o backend confere de novo). */
  permissions: { close: boolean; transfer: boolean };
}

export interface MessageItem {
  id: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  sender: UserRef | null;
  body: string;
  createdAt: string;
  /** Tipo original no WhatsApp (text, image...); null em mensagens internas. */
  externalType: string | null;
  /** Só em mensagens enviadas pelo WhatsApp. */
  deliveryStatus: MessageDeliveryStatus | null;
  /** Motivo legível de falha, sem dados sensíveis. */
  errorMessage: string | null;
}

export interface MessagePage {
  items: MessageItem[];
  // true quando existem mensagens mais antigas que a primeira de items.
  hasMore: boolean;
}

// ---------------------------------------------------------------- FASE 3

/** Visão do SUPERADMIN. O token NUNCA é devolvido: só se existe e quando foi trocado. */
export interface WhatsAppAccountAdminView {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  status: WhatsAppAccountStatus;
  hasAccessToken: boolean;
  tokenUpdatedAt: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Estado global da integração neste servidor (sem segredos). */
export interface WhatsAppPlatformInfo {
  enabled: boolean;
  /** true quando a Graph API configurada não é a oficial (servidor simulado local). */
  simulated: boolean;
  graphApiVersion: string;
  webhookPath: string;
  missing: string[];
}

export interface WhatsAppAdminResponse {
  platform: WhatsAppPlatformInfo;
  account: WhatsAppAccountAdminView | null;
}

/** O que a empresa cliente pode ver da própria conexão. */
export interface WhatsAppCompanyStatus {
  connected: boolean;
  status: WhatsAppAccountStatus | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

// ---------------------------------------------------------------- FASE 4

export interface AiSettingsView {
  enabled: boolean;
  defaultConversationMode: ConversationMode;
  assistantName: string;
  tone: AiTone;
  instructions: string | null;
  /** Texto personalizado (null = usa o padrão). */
  handoffMessage: string | null;
  /** Texto que de fato é enviado ao cliente. */
  effectiveHandoffMessage: string;
  alwaysOn: boolean;
  timezone: string;
  scheduleDays: number[];
  scheduleStart: string;
  scheduleEnd: string;
  /** null enquanto a empresa usa só os valores padrão. */
  updatedAt: string | null;
}

/** Estado do provedor de IA neste servidor. Nunca contém a chave. */
export interface AiPlatformInfo {
  /** true quando ANTHROPIC_API_KEY está definida. */
  configured: boolean;
  /** true quando a API configurada não é a oficial (simulador local). */
  simulated: boolean;
  model: string;
}

export interface AiStatusResponse {
  settings: AiSettingsView;
  platform: AiPlatformInfo;
  /** A IA está, neste momento, dentro do horário permitido. */
  withinSchedule: boolean;
  /** Resumo do que impede respostas automáticas agora (vazio = pode responder). */
  blockers: string[];
  knowledge: { total: number; active: number; activeChars: number; contextLimitChars: number };
  /** O que o usuário atual pode editar. */
  permissions: { editSettings: boolean; editAdminSettings: boolean; editKnowledge: boolean };
}

export interface KnowledgeEntryItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeListResponse extends Paginated<KnowledgeEntryItem> {
  canEdit: boolean;
}

export interface AiRunItem {
  id: string;
  createdAt: string;
  conversationId: string;
  model: string;
  result: AiRunResult;
  stopReason: string | null;
  handoffReason: AiHandoffReason | null;
  errorType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  /** Estimativa em USD (string decimal); null = consumo ou preço indisponível. */
  costUsd: string | null;
  latencyMs: number | null;
  messageCount: number;
  /** Fase 6: API chamada (oficial, simulador) ou origem não verificada (registro antigo). */
  apiSource: AiUsageSource;
}

export interface AiUsageSummary {
  /** Fase 6: mesmo período de calendário do Analytics (fuso da plataforma). */
  period: AnalyticsPeriodInfo;
  runs: number;
  byResult: Record<AiRunResult, number>;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Soma das estimativas conhecidas (string decimal, USD). */
  estimatedCostUsd: string;
  /** Execuções sem consumo informado pela API (não entram nos totais). */
  runsWithoutUsage: number;
  /** Execuções com consumo, mas sem preço configurado para o modelo (custo fora da soma). */
  runsWithoutPrice: number;
  byModel: { model: string; runs: number; estimatedCostUsd: string }[];
  daily: { date: string; runs: number; estimatedCostUsd: string }[];
  recent: AiRunItem[];
  /** Fase 6: separação por origem; custos simulados ou não verificados nunca são custo real. */
  bySource: AiUsageBucket[];
  pricing: { model: string; inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number } | null;
}

// ---------------------------------------------------------------- FASE 5

export interface TeamMemberItem {
  userId: string;
  name: string;
  /** Só para OWNER/ADMIN e SUPERADMIN. */
  email: string | null;
  role: MemberRole;
  active: boolean;
  /** Ainda não trocou a senha provisória. */
  mustChangePassword: boolean | null;
  availability: AgentAvailability;
  availabilityChangedAt: string | null;
  maxConcurrent: number;
  canAttend: boolean;
  /** Conversas atribuídas agora (ocupam vaga). */
  activeConversations: number;
  isMe: boolean;
}

export interface TeamResponse {
  members: TeamMemberItem[];
  me: TeamMemberItem | null;
  /** OWNER/ADMIN da empresa. O SUPERADMIN só consulta. */
  canManage: boolean;
  queue: { waiting: number };
  settings: { inactivityTimeoutMinutes: number };
}

export interface EligibleAssignee {
  userId: string;
  name: string;
  activeConversations: number;
  maxConcurrent: number;
}
