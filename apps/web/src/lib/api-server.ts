import { API_ERROR_CODES, parseCookieSecure, sessionCookieName, type ApiError, type MeResponse } from "@arthur-ai/shared";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

const SESSION_COOKIE = sessionCookieName(parseCookieSecure(process.env["SESSION_COOKIE_SECURE"], process.env.NODE_ENV));

function apiUrl(path: string): string {
  const base = process.env["API_URL"];
  if (!base) throw new Error("API_URL não definida.");
  return `${new URL(base).origin}/api${path}`;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError | null };

/**
 * GET à API a partir de Server Components, repassando apenas o cookie de sessão.
 * Chamada servidor→servidor: não passa pelo rewrite e nunca expõe a URL interna ao navegador.
 */
async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
  if (response.ok) return { ok: true, data: (await response.json()) as T };
  const error = (await response.json().catch(() => null)) as ApiError | null;
  return { ok: false, status: response.status, error };
}

/** Busca dados de página: 401 → /login, troca de senha pendente → /change-password, 404 → notFound. */
export async function fetchPageData<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result.ok) return result.data;
  if (result.status === 401) redirect("/login");
  if (result.error?.code === API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED) redirect("/change-password");
  // Fase 7: empresa suspensa durante a navegação → tela de suspensão (a API recusa todas as rotas da empresa).
  if (result.error?.code === API_ERROR_CODES.COMPANY_SUSPENDED) redirect("/suspended");
  if (result.status === 404) notFound();
  throw new Error(result.error?.message ?? `Falha ao carregar ${path} (${result.status}).`);
}

/** Como fetchPageData, mas 404 vira null (ex.: conversa selecionada que não existe para esta empresa). */
export async function fetchPageDataOrNull<T>(path: string): Promise<T | null> {
  const result = await apiGet<T>(path);
  if (result.ok) return result.data;
  if (result.status === 404 || result.status === 400) return null;
  return fetchPageData<T>(path);
}

/** Usuário da sessão atual, ou null. Memoizado por request. */
export const getMe = cache(async (): Promise<MeResponse | null> => {
  const result = await apiGet<MeResponse>("/auth/me");
  if (result.ok) return result.data;
  if (result.status === 401) return null;
  throw new Error(result.error?.message ?? "Falha ao carregar a sessão.");
});

/** Exige sessão válida e senha já trocada. O backend continua sendo a autoridade: isto só redireciona. */
export async function requireUser(): Promise<MeResponse> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.user.mustChangePassword) redirect("/change-password");
  return me;
}

/** Exige vínculo com empresa e devolve o id dela. A API revalida o vínculo em toda chamada. */
export async function requireMembership(): Promise<{ me: MeResponse; companyId: string }> {
  const me = await requireUser();
  if (!me.membership) redirect("/");
  return { me, companyId: me.membership.company.id };
}
