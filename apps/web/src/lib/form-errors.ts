import type { ApiError } from "@arthur-ai/shared";
import type { z } from "zod";

export type FieldErrors = Record<string, string>;

/** Primeiro erro por campo, vindo do schema compartilhado (cliente) ou dos details da API. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    errors[key] ??= issue.message;
  }
  return errors;
}

export function apiFieldErrors(error: ApiError): FieldErrors {
  const errors: FieldErrors = {};
  for (const detail of error.details ?? []) {
    errors[detail.path || "_form"] ??= detail.message;
  }
  return errors;
}
