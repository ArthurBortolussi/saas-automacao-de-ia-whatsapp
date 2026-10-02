import { z } from "zod";

export const OFFICIAL_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
// Sonnet é a decisão do proprietário para os atendimentos; Opus não é o padrão.
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";
// Marcador dos valores fictícios do .env.example (simulador local): nunca aceitos em produção.
const EXAMPLE_KEY_MARKER = "SIMULADO";

export interface AiPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export interface AiConfig {
  /** true quando há chave da Anthropic. Sem ela a IA não responde, mas o resto do sistema funciona. */
  configured: boolean;
  /** API diferente da oficial (simulador local). */
  simulated: boolean;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxOutputTokens: number;
  requestTimeoutMs: number;
  /** Espera após a última mensagem do cliente antes de gerar (agrupamento). */
  batchDelayMs: number;
  /** Teto da espera: cliente que não para de escrever recebe resposta mesmo assim. */
  batchMaxWaitMs: number;
  historyMaxMessages: number;
  historyMaxChars: number;
  knowledgeMaxChars: number;
  /** Proteção contra loops (ex.: robô do outro lado): execuções por conversa por hora. */
  maxRunsPerConversationPerHour: number;
  workerIntervalMs: number;
  /** Preço configurado por variável de ambiente para AI_MODEL (substitui a tabela interna). */
  priceOverride: AiPrice | null;
}

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const int = (min: number, max: number, fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));
const price = z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1000).optional());

export const aiEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().min(10, "Chave muito curta.").regex(/^\S+$/, "Sem espaços.").optional()),
  ANTHROPIC_BASE_URL: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^https?$/ }).default(OFFICIAL_ANTHROPIC_BASE_URL).transform((value) => new URL(value).origin),
  ),
  AI_MODEL: z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9.-]{3,80}$/, "Identificador de modelo inválido.").default(DEFAULT_AI_MODEL)),
  AI_EFFORT: z.preprocess(blankToUndefined, z.enum(["low", "medium", "high"]).default("low")),
  AI_MAX_OUTPUT_TOKENS: int(256, 16_000, 3000),
  AI_REQUEST_TIMEOUT_MS: int(5_000, 300_000, 60_000),
  AI_BATCH_DELAY_MS: int(0, 120_000, 8000),
  AI_BATCH_MAX_WAIT_MS: int(0, 600_000, 30_000),
  AI_HISTORY_MAX_MESSAGES: int(1, 200, 30),
  AI_HISTORY_MAX_CHARS: int(1000, 200_000, 12_000),
  AI_KNOWLEDGE_MAX_CHARS: int(1000, 400_000, 40_000),
  AI_MAX_RUNS_PER_CONVERSATION_PER_HOUR: int(1, 1000, 20),
  AI_WORKER_INTERVAL_MS: int(0, 600_000, 2000),
  AI_PRICE_INPUT_PER_MTOK: price,
  AI_PRICE_OUTPUT_PER_MTOK: price,
  AI_PRICE_CACHE_WRITE_PER_MTOK: price,
  AI_PRICE_CACHE_READ_PER_MTOK: price,
});

type AiEnv = z.output<typeof aiEnvSchema>;

/** Monta a configuração e devolve erros de consistência (vazio = ok). */
export function buildAiConfig(env: AiEnv, nodeEnv: string): { config: AiConfig; errors: string[] } {
  const errors: string[] = [];
  const simulated = env.ANTHROPIC_BASE_URL !== OFFICIAL_ANTHROPIC_BASE_URL;
  if (nodeEnv === "production") {
    if (simulated) errors.push("ANTHROPIC_BASE_URL: em produção só a API oficial da Anthropic é aceita.");
    if (env.ANTHROPIC_API_KEY?.includes(EXAMPLE_KEY_MARKER)) errors.push("ANTHROPIC_API_KEY contém o valor fictício do .env.example.");
  }
  const prices = [env.AI_PRICE_INPUT_PER_MTOK, env.AI_PRICE_OUTPUT_PER_MTOK, env.AI_PRICE_CACHE_WRITE_PER_MTOK, env.AI_PRICE_CACHE_READ_PER_MTOK];
  const definedPrices = prices.filter((value) => value !== undefined).length;
  if (definedPrices > 0 && definedPrices < 4) {
    errors.push("AI_PRICE_*: informe os quatro preços (entrada, saída, escrita e leitura de cache) ou nenhum.");
  }
  if (env.AI_BATCH_MAX_WAIT_MS < env.AI_BATCH_DELAY_MS) errors.push("AI_BATCH_MAX_WAIT_MS deve ser maior ou igual a AI_BATCH_DELAY_MS.");

  const [input, output, cacheWrite, cacheRead] = prices;
  return {
    config: {
      configured: Boolean(env.ANTHROPIC_API_KEY),
      simulated,
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.AI_MODEL,
      effort: env.AI_EFFORT,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      batchDelayMs: env.AI_BATCH_DELAY_MS,
      batchMaxWaitMs: env.AI_BATCH_MAX_WAIT_MS,
      historyMaxMessages: env.AI_HISTORY_MAX_MESSAGES,
      historyMaxChars: env.AI_HISTORY_MAX_CHARS,
      knowledgeMaxChars: env.AI_KNOWLEDGE_MAX_CHARS,
      maxRunsPerConversationPerHour: env.AI_MAX_RUNS_PER_CONVERSATION_PER_HOUR,
      workerIntervalMs: env.AI_WORKER_INTERVAL_MS,
      priceOverride:
        input !== undefined && output !== undefined && cacheWrite !== undefined && cacheRead !== undefined
          ? { inputPerMTok: input, outputPerMTok: output, cacheWritePerMTok: cacheWrite, cacheReadPerMTok: cacheRead }
          : null,
    },
    errors,
  };
}
