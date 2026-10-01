import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ENV, type Env } from "../config/env.js";
import { classifyMetaError, networkError } from "./whatsapp-errors.js";

const REQUEST_TIMEOUT_MS = 10_000;

/** Credenciais já decifradas de UM número. Vivem só em memória, durante a chamada. */
export interface NumberCredentials {
  phoneNumberId: string;
  accessToken: string;
}

/** Conteúdo enviável. "template" fica pronto para mensagens fora da janela de 24h (fase futura). */
export type OutboundContent =
  | { type: "text"; body: string }
  | { type: "template"; name: string; languageCode: string; components?: unknown[] };

const sendResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1).max(128) })).min(1),
});

const phoneNumberSchema = z.object({
  display_phone_number: z.string().optional(),
  verified_name: z.string().optional(),
  quality_rating: z.string().optional(),
});

const errorBodySchema = z.object({ error: z.object({ code: z.number().optional() }).loose() }).loose();

/**
 * Único ponto de contato com a WhatsApp Cloud API (Graph API oficial).
 * Nunca registra o token: ele só existe no header Authorization da requisição.
 */
@Injectable()
export class CloudApiClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendMessage(credentials: NumberCredentials, to: string, content: OutboundContent): Promise<{ externalId: string }> {
    const body =
      content.type === "text"
        ? { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: content.body, preview_url: false } }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: { name: content.name, language: { code: content.languageCode }, components: content.components ?? [] },
          };
    const json = await this.request("POST", `${credentials.phoneNumberId}/messages`, credentials.accessToken, body);
    const parsed = sendResponseSchema.safeParse(json);
    if (!parsed.success) throw classifyMetaError(undefined, 502);
    const first = parsed.data.messages[0];
    if (!first) throw classifyMetaError(undefined, 502);
    return { externalId: first.id };
  }

  /** Usado no "Testar conexão": confirma que o token enxerga o número. */
  async getPhoneNumber(credentials: NumberCredentials): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
    const json = await this.request(
      "GET",
      `${credentials.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      credentials.accessToken,
    );
    const parsed = phoneNumberSchema.safeParse(json);
    if (!parsed.success) throw classifyMetaError(undefined, 502);
    return { displayPhoneNumber: parsed.data.display_phone_number ?? null, verifiedName: parsed.data.verified_name ?? null };
  }

  private async request(method: "GET" | "POST", path: string, accessToken: string, body?: unknown): Promise<unknown> {
    const { graphBaseUrl, graphApiVersion } = this.env.whatsapp;
    let response: Response;
    try {
      response = await fetch(`${graphBaseUrl}/${graphApiVersion}/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw networkError();
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return json;
    const parsed = errorBodySchema.safeParse(json);
    throw classifyMetaError(parsed.success ? parsed.data.error.code : undefined, response.status);
  }
}
