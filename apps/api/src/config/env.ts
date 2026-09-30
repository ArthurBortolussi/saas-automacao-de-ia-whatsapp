import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseCookieSecure } from "@arthur-ai/shared";
import { z } from "zod";

const trustProxySchema = z
  .string()
  .trim()
  .default("false")
  .refine((value) => value !== "true", {
    message: 'TRUST_PROXY=true confia em qualquer X-Forwarded-For (falsificável). Use "loopback", IPs/CIDRs ou número de hops.',
  })
  .transform((value): boolean | number | string => {
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
  TRUST_PROXY: trustProxySchema,
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export type Env = z.output<typeof envSchema> & { cookieSecure: boolean };
export const ENV = Symbol("ENV");

let rootEnvLoaded = false;

// Falha rápido: qualquer variável ausente ou inválida derruba o boot com a lista de problemas.
export function loadEnv(): Env {
  if (!rootEnvLoaded) {
    const rootEnv = resolve(import.meta.dirname, "../../../../.env");
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
    rootEnvLoaded = true;
  }
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${problems}`);
  }
  const cookieSecure = parseCookieSecure(result.data.SESSION_COOKIE_SECURE, result.data.NODE_ENV);
  if (result.data.NODE_ENV === "production" && !cookieSecure) {
    throw new Error("Variáveis de ambiente inválidas:\n  - SESSION_COOKIE_SECURE: deve ser true em produção.");
  }
  return { ...result.data, cookieSecure };
}
