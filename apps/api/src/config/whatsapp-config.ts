import { z } from "zod";

export const OFFICIAL_GRAPH_BASE_URL = "https://graph.facebook.com";
// Valores fictícios publicados no .env.example: nunca aceitos em produção.
const EXAMPLE_MARKER = "NAO-USAR-EM-PRODUCAO";
const EXAMPLE_ENCRYPTION_KEY = "YXJ0aHVyLWFpLWNoYXZlLWZpY3RpY2lhLWRlLWRldiE=";

export interface WhatsAppConfig {
  /** true quando App Secret, verify token e chave de criptografia estão presentes. */
  enabled: boolean;
  /** Graph API diferente da oficial (servidor simulado local). */
  simulated: boolean;
  graphBaseUrl: string;
  graphApiVersion: string;
  appSecret: string | null;
  verifyToken: string | null;
  encryptionKey: Buffer | null;
  workerIntervalMs: number;
  missing: string[];
}

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const whatsappEnvSchema = z.object({
  WHATSAPP_GRAPH_API_VERSION: z
    .preprocess(blankToUndefined, z.string().regex(/^v\d{2,3}\.0$/, 'Use o formato "vNN.0", ex.: v25.0.').default("v25.0")),
  WHATSAPP_GRAPH_API_BASE_URL: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^https?$/ }).default(OFFICIAL_GRAPH_BASE_URL).transform((value) => new URL(value).origin),
  ),
  WHATSAPP_APP_SECRET: z.preprocess(blankToUndefined, z.string().min(16, "Mínimo de 16 caracteres.").optional()),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.preprocess(
    blankToUndefined,
    z.string().min(16, "Mínimo de 16 caracteres.").regex(/^\S+$/, "Sem espaços.").optional(),
  ),
  WHATSAPP_TOKEN_ENCRYPTION_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 32, "Precisa ser 32 bytes em base64 (veja o README).")
      .optional(),
  ),
  WHATSAPP_WORKER_INTERVAL_MS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(600_000).default(5000)),
});

type WhatsAppEnv = z.output<typeof whatsappEnvSchema>;

/** Monta a configuração e devolve erros de consistência (vazio = ok). */
export function buildWhatsAppConfig(env: WhatsAppEnv, nodeEnv: string): { config: WhatsAppConfig; errors: string[] } {
  const required = {
    WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    WHATSAPP_TOKEN_ENCRYPTION_KEY: env.WHATSAPP_TOKEN_ENCRYPTION_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const errors: string[] = [];

  // Tudo ou nada: configuração parcial é quase sempre erro de deploy, e deve falhar no boot.
  if (missing.length > 0 && missing.length < 3) {
    errors.push(`WhatsApp configurado pela metade. Faltam: ${missing.join(", ")} (ou remova todas as variáveis WHATSAPP_*).`);
  }
  const simulated = env.WHATSAPP_GRAPH_API_BASE_URL !== OFFICIAL_GRAPH_BASE_URL;
  if (nodeEnv === "production") {
    if (simulated) errors.push("WHATSAPP_GRAPH_API_BASE_URL: em produção só a Graph API oficial é aceita.");
    const values = Object.values(required);
    if (values.some((value) => value?.includes(EXAMPLE_MARKER)) || env.WHATSAPP_TOKEN_ENCRYPTION_KEY === EXAMPLE_ENCRYPTION_KEY) {
      errors.push("Variáveis WHATSAPP_* contêm os valores fictícios do .env.example. Gere segredos reais.");
    }
  }

  const enabled = missing.length === 0;
  return {
    config: {
      enabled,
      simulated,
      graphBaseUrl: env.WHATSAPP_GRAPH_API_BASE_URL,
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      appSecret: env.WHATSAPP_APP_SECRET ?? null,
      verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
      encryptionKey: env.WHATSAPP_TOKEN_ENCRYPTION_KEY ? Buffer.from(env.WHATSAPP_TOKEN_ENCRYPTION_KEY, "base64") : null,
      workerIntervalMs: env.WHATSAPP_WORKER_INTERVAL_MS,
      missing,
    },
    errors,
  };
}
