import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { SkipOriginCheck } from "../common/decorators/skip-origin-check.decorator.js";
import { ENV, type Env } from "../config/env.js";
import { WebhookIngestService } from "./webhook-ingest.service.js";
import { isValidSignature, safeEqual } from "./webhook-signature.js";
import { WhatsAppWorker } from "./whatsapp-worker.service.js";

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Endpoint público chamado pela Meta. Sem sessão e sem Origin: a autenticidade vem da assinatura
 * X-Hub-Signature-256 (App Secret) e, no handshake, do verify token.
 */
@Controller("webhooks/whatsapp")
@Public()
@SkipOriginCheck()
export class WhatsAppWebhookController {
  constructor(
    private readonly ingest: WebhookIngestService,
    private readonly worker: WhatsAppWorker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Handshake de verificação: devolve hub.challenge se o verify token conferir. */
  @Get()
  verify(@Query() query: Record<string, unknown>, @Res() response: Response): void {
    const { verifyToken } = this.env.whatsapp;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];
    if (
      !verifyToken ||
      mode !== "subscribe" ||
      typeof token !== "string" ||
      !safeEqual(token, verifyToken) ||
      typeof challenge !== "string" ||
      !CHALLENGE_PATTERN.test(challenge)
    ) {
      throw new ForbiddenException("Verificação do webhook recusada.");
    }
    response.status(200).type("text/plain").send(challenge);
  }

  /** Recebe eventos: valida a assinatura, grava na fila e responde 200 sem esperar o processamento. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
  ): Promise<{ received: true }> {
    const { appSecret, enabled } = this.env.whatsapp;
    // 503 faz a Meta reenviar depois: nada se perde enquanto o servidor não está configurado.
    if (!enabled || !appSecret) throw new ServiceUnavailableException("Integração com o WhatsApp desabilitada.");
    const raw = request.rawBody;
    if (!raw || !isValidSignature(raw, signature, appSecret)) throw new UnauthorizedException("Assinatura inválida.");

    const payload: unknown = request.body;
    if (typeof payload !== "object" || payload === null) return { received: true };
    if (await this.ingest.ingest(raw, payload)) this.worker.kick();
    return { received: true };
  }
}
