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
