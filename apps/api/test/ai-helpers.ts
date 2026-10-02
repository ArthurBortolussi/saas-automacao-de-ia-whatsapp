import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Chave FICTÍCIA, exclusiva dos testes: nenhum teste fala com a Anthropic real.
export const TEST_ANTHROPIC_KEY = "sk-ant-teste-SIMULADO-0123456789";

export interface AnthropicRequest {
  apiKey: string | undefined;
  body: {
    model: string;
    max_tokens: number;
    system: { type: string; text: string; cache_control?: unknown }[];
    messages: { role: "user" | "assistant"; content: string }[];
    tools: { name: string }[];
    output_config?: { effort?: string };
    thinking?: unknown;
    tool_choice?: { type: string };
  };
}

type Answer = { status: number; json: unknown } | "drop";
export type AnthropicResponder = (request: AnthropicRequest) => Answer | Promise<Answer>;

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

let sequence = 0;
function message(content: unknown[], stopReason: string, usage: Usage = {}): { status: number; json: unknown } {
  sequence += 1;
  return {
    status: 200,
    json: {
      id: `msg_teste_${sequence}`,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details: stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
      usage: {
        input_tokens: usage.input_tokens ?? 1000,
        output_tokens: usage.output_tokens ?? 50,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
    },
  };
}

export const replyText = (text: string, usage?: Usage) => message([{ type: "text", text }], "end_turn", usage);
export const replyHandoff = (motivo: string) =>
  message([{ type: "tool_use", id: `toolu_${sequence}`, name: "transferir_para_humano", input: { motivo } }], "tool_use");
export const replyRefusal = () => message([], "refusal");
export const replyTruncated = () => message([{ type: "text", text: "Resposta cortada no meio" }], "max_tokens");
export function apiError(status: number, type: string): { status: number; json: unknown } {
  return { status, json: { type: "error", error: { type, message: "erro simulado" } } };
}

/** Servidor HTTP que imita POST /v1/messages da Anthropic; o SDK oficial é usado de verdade contra ele. */
export class MockAnthropicApi {
  readonly requests: AnthropicRequest[] = [];
  private responder: AnthropicResponder = () => replyText("Olá! Como posso ajudar?");
  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "rota" } }));
          return;
        }
        const header = req.headers["x-api-key"];
        const request: AnthropicRequest = {
          apiKey: Array.isArray(header) ? header[0] : header,
          body: JSON.parse(raw) as AnthropicRequest["body"],
        };
        this.requests.push(request);
        return Promise.resolve(this.responder(request)).then((answer) => {
          if (answer === "drop") {
            res.destroy();
            return;
          }
          // retry-after-ms curto: a retentativa interna do SDK não atrasa os testes.
          res.writeHead(answer.status, { "Content-Type": "application/json", "retry-after-ms": "1" });
          res.end(JSON.stringify(answer.json));
        });
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  respondWith(responder: AnthropicResponder): void {
    this.responder = responder;
  }

  reset(): void {
    this.requests.length = 0;
    this.responder = () => replyText("Olá! Como posso ajudar?");
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Liga a IA (chave fictícia) apontando para o servidor simulado. Devolve a função de restauração. */
export function enableAiEnv(anthropicUrl: string, overrides: Record<string, string> = {}): () => void {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY,
    ANTHROPIC_BASE_URL: anthropicUrl,
    AI_BATCH_DELAY_MS: "0",
    AI_BATCH_MAX_WAIT_MS: "0",
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous[key];
    }
  };
}
