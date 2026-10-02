import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable } from "@nestjs/common";
import type { AiConfig } from "../config/ai-config.js";
import { ENV, type Env } from "../config/env.js";

export interface ModelRequest {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}

export type ModelOutcome =
  | { kind: "response"; message: Anthropic.Message; latencyMs: number }
  | { kind: "error"; retryable: boolean; errorType: string; status: number | null; latencyMs: number };

/**
 * Único ponto do sistema que fala com a API da Anthropic (SDK oficial).
 * A chave vem só do ambiente e nunca sai daqui: não é logada, gravada nem devolvida.
 */
@Injectable()
export class AiModelClient {
  private readonly config: AiConfig;
  private readonly client: Anthropic | null;

  constructor(@Inject(ENV) env: Env) {
    this.config = env.ai;
    this.client = env.ai.apiKey
      ? new Anthropic({
          apiKey: env.ai.apiKey,
          baseURL: env.ai.baseUrl,
          timeout: env.ai.requestTimeoutMs,
          // Uma retentativa rápida do próprio SDK; as demais ficam com a fila (backoff longo e limitado).
          maxRetries: 1,
        })
      : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async generate(request: ModelRequest): Promise<ModelOutcome> {
    const started = Date.now();
    if (!this.client) return { kind: "error", retryable: false, errorType: "not_configured", status: null, latencyMs: 0 };
    try {
      const message = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxOutputTokens,
        // Sem `thinking`: o Sonnet usa raciocínio adaptativo; o esforço baixo mantém respostas de chat rápidas e baratas.
        output_config: { effort: this.config.effort },
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        // Forçar ferramenta não é aceito neste modelo: "auto" + instrução no prompt.
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
      });
      return { kind: "response", message, latencyMs: Date.now() - started };
    } catch (error) {
      return { kind: "error", ...classifyError(error), latencyMs: Date.now() - started };
    }
  }
}

/** Erros pelas classes tipadas do SDK (sem comparar textos). Mais específico primeiro. */
export function classifyError(error: unknown): { retryable: boolean; errorType: string; status: number | null } {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { retryable: true, errorType: "timeout", status: null };
  if (error instanceof Anthropic.APIConnectionError) return { retryable: true, errorType: "connection", status: null };
  if (error instanceof Anthropic.AuthenticationError) return { retryable: false, errorType: "authentication", status: 401 };
  if (error instanceof Anthropic.PermissionDeniedError) return { retryable: false, errorType: "permission", status: 403 };
  if (error instanceof Anthropic.NotFoundError) return { retryable: false, errorType: "not_found", status: 404 };
  if (error instanceof Anthropic.RateLimitError) return { retryable: true, errorType: "rate_limit", status: 429 };
  if (error instanceof Anthropic.BadRequestError) return { retryable: false, errorType: "invalid_request", status: 400 };
  if (error instanceof Anthropic.InternalServerError) {
    return { retryable: true, errorType: error.status === 529 ? "overloaded" : "server_error", status: error.status };
  }
  if (error instanceof Anthropic.APIError) {
    // 402 = billing_error (créditos/pagamento): não adianta repetir.
    if (error.status === 402) return { retryable: false, errorType: "billing", status: 402 };
    return { retryable: false, errorType: "api_error", status: typeof error.status === "number" ? error.status : null };
  }
  return { retryable: false, errorType: "unexpected", status: null };
}
