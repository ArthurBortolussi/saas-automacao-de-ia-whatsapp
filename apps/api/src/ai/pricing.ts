import type { AiPrice } from "../config/ai-config.js";

/**
 * Preços oficiais da API da Anthropic (USD por milhão de tokens), conferidos em
 * https://platform.claude.com/docs/en/about-claude/pricing em 2026-10-02.
 * Escrita de cache = cache de 5 minutos (o padrão usado aqui). Podem mudar: para o modelo configurado,
 * as variáveis AI_PRICE_* substituem esta tabela sem alterar o código.
 */
export const OFFICIAL_PRICES: Readonly<Record<string, AiPrice>> = {
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function priceFor(model: string, configuredModel: string, override: AiPrice | null): AiPrice | null {
  if (override && model === configuredModel) return override;
  return OFFICIAL_PRICES[model] ?? null;
}

/**
 * Custo ESTIMADO em USD com 6 casas, ou null se não houver preço para o modelo.
 * input_tokens da API já exclui os tokens lidos/escritos em cache, que têm preço próprio.
 */
export function estimateCostUsd(usage: TokenUsage, price: AiPrice | null): string | null {
  if (!price) return null;
  const micro =
    usage.inputTokens * price.inputPerMTok +
    usage.outputTokens * price.outputPerMTok +
    usage.cacheCreationInputTokens * price.cacheWritePerMTok +
    usage.cacheReadInputTokens * price.cacheReadPerMTok;
  return (micro / 1_000_000).toFixed(6);
}
