import type { ApiError } from "@arthur-ai/shared";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Mutação a partir do navegador, sempre via /api (same-origin, cookie first-party). */
export async function apiMutate<T = void>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ClientResult<T>> {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: json as T };
    const error = (json as ApiError | null) ?? {
      statusCode: response.status,
      error: "Error",
      message: "Não foi possível concluir a operação.",
    };
    return { ok: false, error };
  } catch {
    return { ok: false, error: { statusCode: 0, error: "Network", message: "Sem conexão com o servidor." } };
  }
}
