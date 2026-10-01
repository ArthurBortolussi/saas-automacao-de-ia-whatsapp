import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@arthur-ai/database";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Grava o webhook autenticado na fila. Rápido (um INSERT) para responder logo à Meta. */
@Injectable()
export class WebhookIngestService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devolve false se o payload idêntico já tinha sido recebido (reenvio da Meta). */
  async ingest(rawBody: Buffer, payload: Prisma.InputJsonValue): Promise<boolean> {
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    try {
      await this.prisma.whatsAppWebhookEvent.create({ data: { payloadSha256, payload } });
      return true;
    } catch (error) {
      if (uniqueViolationIndex(error) === "WhatsAppWebhookEvent_payloadSha256_key") return false;
      throw error;
    }
  }
}
