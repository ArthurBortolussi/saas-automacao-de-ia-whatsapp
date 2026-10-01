import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signPayload } from "../src/whatsapp/webhook-signature.js";
import { TokenCipher } from "@arthur-ai/database/token-cipher";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { TestContext } from "./helpers.js";

// Valores FICTÍCIOS, exclusivos dos testes automatizados.
export const TEST_APP_SECRET = "test-app-secret-0123456789abcdef";
export const TEST_VERIFY_TOKEN = "test-verify-token-0123456789";
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
export const GRAPH_VERSION = "v25.0";

export interface GraphRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

export type GraphResponder = (request: GraphRequest) => { status: number; json: unknown } | "drop";

/** Servidor HTTP que imita a Graph API: registra as chamadas e responde conforme o teste mandar. */
export class MockGraphApi {
  readonly requests: GraphRequest[] = [];
  private responder: GraphResponder = defaultResponder;
  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const request: GraphRequest = {
          method: req.method ?? "",
          path: req.url ?? "",
          authorization: req.headers.authorization,
          body: raw ? (JSON.parse(raw) as unknown) : null,
        };
        this.requests.push(request);
        const answer = this.responder(request);
        if (answer === "drop") {
          res.destroy();
          return;
        }
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(answer.json));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  respondWith(responder: GraphResponder): void {
    this.responder = responder;
  }

  reset(): void {
    this.requests.length = 0;
    this.responder = defaultResponder;
  }

  messageRequests(): GraphRequest[] {
    return this.requests.filter((request) => request.method === "POST" && request.path.endsWith("/messages"));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }
}

let wamidSequence = 0;
export function nextWamid(prefix = "wamid.OUT"): string {
  wamidSequence += 1;
  return `${prefix}.${Date.now().toString(36)}${wamidSequence}`;
}

const defaultResponder: GraphResponder = (request) => {
  if (request.method === "POST" && request.path.endsWith("/messages")) {
    return { status: 200, json: { messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: nextWamid() }] } };
  }
  if (request.method === "GET") return { status: 200, json: { display_phone_number: "+55 11 4000-0000", verified_name: "Empresa Teste", id: "1" } };
  return { status: 404, json: { error: { code: 100, message: "not found" } } };
};

export function metaError(code: number, status = 400): { status: number; json: unknown } {
  return { status, json: { error: { message: "erro simulado", type: "OAuthException", code, fbtrace_id: "TRACE" } } };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Liga a integração (valores fictícios) apontando para o servidor simulado. Devolve a função de restauração. */
export function enableWhatsAppEnv(graphUrl: string): () => void {
  const keys = [
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "WHATSAPP_TOKEN_ENCRYPTION_KEY",
    "WHATSAPP_GRAPH_API_BASE_URL",
    "WHATSAPP_GRAPH_API_VERSION",
    "WHATSAPP_WORKER_INTERVAL_MS",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env["WHATSAPP_APP_SECRET"] = TEST_APP_SECRET;
  process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] = TEST_VERIFY_TOKEN;
  process.env["WHATSAPP_TOKEN_ENCRYPTION_KEY"] = TEST_ENCRYPTION_KEY;
  process.env["WHATSAPP_GRAPH_API_BASE_URL"] = graphUrl;
  process.env["WHATSAPP_GRAPH_API_VERSION"] = GRAPH_VERSION;
  // Sem timer: os testes processam a fila explicitamente (worker.drain()).
  process.env["WHATSAPP_WORKER_INTERVAL_MS"] = "0";
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous[key];
    }
  };
}

export async function createAccountRow(
  prisma: PrismaService,
  companyId: string,
  phoneNumberId: string,
  options: { token?: string; status?: "PENDING" | "ACTIVE" | "ERROR" | "DISABLED" } = {},
) {
  const cipher = new TokenCipher(Buffer.from(TEST_ENCRYPTION_KEY, "base64"));
  return prisma.whatsAppAccount.create({
    data: {
      companyId,
      wabaId: "100000000000001",
      phoneNumberId,
      displayPhoneNumber: "+55 11 4000-0000",
      accessTokenCiphertext: cipher.encrypt(options.token ?? `token-da-${phoneNumberId}-0123456789`, companyId),
      tokenUpdatedAt: new Date(),
      status: options.status ?? "ACTIVE",
    },
  });
}

// ---------------------------------------------------------------- payloads no formato da Meta

export interface InboundSpec {
  phoneNumberId: string;
  from: string;
  wamid?: string;
  text?: string;
  name?: string;
  timestamp?: number;
  type?: string;
}

export function inboundPayload(...messages: InboundSpec[]): Record<string, unknown> {
  const first = messages[0];
  if (!first) throw new Error("ao menos uma mensagem");
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "554000000000", phone_number_id: first.phoneNumberId },
              contacts: messages.map((m) => ({ profile: { name: m.name ?? "Cliente WhatsApp" }, wa_id: m.from })),
              messages: messages.map((m) => ({
                from: m.from,
                id: m.wamid ?? nextWamid("wamid.IN"),
                timestamp: String(m.timestamp ?? Math.floor(Date.now() / 1000)),
                type: m.type ?? "text",
                ...((m.type ?? "text") === "text" ? { text: { body: m.text ?? "Olá!" } } : { [m.type ?? "image"]: { id: "media-1" } }),
              })),
            },
          },
        ],
      },
    ],
  };
}

export function statusPayload(
  phoneNumberId: string,
  wamid: string,
  status: string,
  options: { timestamp?: number; errorCode?: number } = {},
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "554000000000", phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
                  recipient_id: "5511999990000",
                  ...(options.errorCode ? { errors: [{ code: options.errorCode, title: "erro" }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** POST do webhook exatamente como a Meta faz: corpo bruto + X-Hub-Signature-256. */
export function postWebhook(ctx: TestContext, payload: unknown, options: { secret?: string; signature?: string; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(payload);
  return ctx.http
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", options.signature ?? signPayload(raw, options.secret ?? TEST_APP_SECRET))
    .send(raw);
}
