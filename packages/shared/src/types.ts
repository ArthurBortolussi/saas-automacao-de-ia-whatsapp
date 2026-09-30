import type { CompanyStatus, GlobalRole, MemberRole, UserStatus } from "./enums.js";

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
