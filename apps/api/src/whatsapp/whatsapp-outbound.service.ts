import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Company, type ConversationMode } from "@arthur-ai/database";
import { aiMayReply, humanMayReply, isServiceWindowOpen, type MessageItem } from "@arthur-ai/shared";
import { messagePreview, toMessageItem, userRefSelect } from "../conversations/conversation.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CloudApiClient } from "./cloud-api.client.js";
import { WhatsAppAccountsService } from "./whatsapp-accounts.service.js";
import { WhatsAppApiError } from "./whatsapp-errors.js";

/** Quem está enviando. "AI" já é aceito aqui para a Fase 4, sujeito a aiMayReply(). */
export type OutboundSender = { type: "AGENT"; userId: string } | { type: "AI" };

const MAX_ATTEMPTS = 5;
// Enquanto uma tentativa está em curso, a mensagem fica "reservada" por este tempo.
const SEND_LEASE_MS = 60_000;
const backoffMs = (attempt: number) => Math.min(15 * 60_000, 2 ** attempt * 5_000);

const WINDOW_CLOSED = "A janela de 24 horas do WhatsApp está fechada: o cliente não envia mensagens há mais de 24h. Só é possível enviar um modelo aprovado pela Meta (disponível em fase futura).";

/**
 * Envio pelo WhatsApp (padrão outbox): a mensagem é gravada como PENDING e só vira SENT com o
 * wamid devolvido pela Meta. Falhas temporárias voltam para a fila; definitivas viram FAILED.
 * É o mesmo serviço que a IA usará na Fase 4.
 */
@Injectable()
export class WhatsAppOutboundService {
  private readonly logger = new Logger(WhatsAppOutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: WhatsAppAccountsService,
    private readonly client: CloudApiClient,
  ) {}

  /** Valida, enfileira e tenta enviar na hora. Devolve o estado real após a tentativa. */
  async send(company: Company, conversationId: string, body: string, sender: OutboundSender): Promise<MessageItem> {
    const loaded = await this.accounts.credentialsFor(company.id);
    if (!loaded) throw new ServiceUnavailableException("O WhatsApp desta empresa não está configurado.");
    if (loaded.account.status === "DISABLED" || loaded.account.status === "ERROR") {
      throw new ServiceUnavailableException(
        loaded.account.status === "DISABLED"
          ? "A integração com o WhatsApp desta empresa está desativada."
          : "A conexão com o WhatsApp está com erro. Peça ao suporte para revisar a configuração.",
      );
    }

    const now = new Date();
    const messageId = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id_companyId: { id: conversationId, companyId: company.id } },
        select: { mode: true, channel: true, lastInboundAt: true },
      });
      if (!conversation) throw new NotFoundException("Conversa não encontrada.");
      if (conversation.channel !== "WHATSAPP") throw new ConflictException("Esta conversa não é do WhatsApp.");
      this.assertSenderAllowed(sender, conversation.mode);
      if (!isServiceWindowOpen(conversation.lastInboundAt, now)) throw new ConflictException(WINDOW_CLOSED);

      // Condicional: se o modo mudou entre a leitura e aqui, nada é gravado.
      const { count } = await tx.conversation.updateMany({
        where: { id: conversationId, companyId: company.id, mode: conversation.mode },
        data: { lastMessageAt: now, lastMessagePreview: messagePreview(body), unreadCount: 0 },
      });
      if (count === 0) throw new ConflictException("A conversa foi alterada por outra pessoa. Atualize a página e tente novamente.");

      const message = await tx.message.create({
        data: {
          companyId: company.id,
          conversationId,
          direction: "OUTBOUND",
          senderType: sender.type,
          senderUserId: sender.type === "AGENT" ? sender.userId : null,
          body,
          deliveryStatus: "PENDING",
          nextSendAttemptAt: now,
          createdAt: now,
        },
        select: { id: true },
      });
      return message.id;
    });

    await this.dispatch(messageId);
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { sender: userRefSelect } });
    return toMessageItem(message);
  }

  /**
   * Uma tentativa de envio. Seguro para chamadas concorrentes: só quem "reserva" a mensagem
   * (update condicional) envia. Usado pelo envio imediato e pelo worker de retentativas.
   */
  async dispatch(messageId: string): Promise<void> {
    const now = new Date();
    const claim = await this.prisma.message.updateMany({
      where: { id: messageId, deliveryStatus: "PENDING", nextSendAttemptAt: { lte: now } },
      data: { nextSendAttemptAt: new Date(now.getTime() + SEND_LEASE_MS), sendAttempts: { increment: 1 } },
    });
    if (claim.count === 0) return;

    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: {
        id: true,
        companyId: true,
        body: true,
        sendAttempts: true,
        conversation: { select: { lastInboundAt: true, contact: { select: { phone: true, whatsappId: true } } } },
      },
    });

    // A janela pode ter fechado enquanto a mensagem esperava uma retentativa.
    if (!isServiceWindowOpen(message.conversation.lastInboundAt, now)) {
      await this.fail(message.id, "WINDOW_CLOSED", WINDOW_CLOSED);
      return;
    }
    // Credenciais da empresa DONA da mensagem; nunca de outra.
    const loaded = await this.accounts.credentialsFor(message.companyId);
    if (!loaded || loaded.account.status === "DISABLED") {
      await this.fail(message.id, "NOT_CONFIGURED", "A integração com o WhatsApp desta empresa está desativada ou ausente.");
      return;
    }

    const to = message.conversation.contact.whatsappId ?? message.conversation.contact.phone;
    try {
      const { externalId } = await this.client.sendMessage(loaded.credentials, to, { type: "text", body: message.body });
      await this.prisma.message.updateMany({
        where: { id: message.id, deliveryStatus: "PENDING" },
        data: { deliveryStatus: "SENT", externalId, sentAt: new Date(), nextSendAttemptAt: null, errorCode: null, errorMessage: null },
      });
    } catch (error) {
      if (!(error instanceof WhatsAppApiError)) {
        this.logger.error(`Erro inesperado ao enviar mensagem ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
        await this.retryOrFail(message.id, message.sendAttempts, "UNEXPECTED", "Erro inesperado ao enviar. O sistema tentará novamente.");
        return;
      }
      if (error.kind === "auth") await this.accounts.markError(message.companyId, error);
      if (error.retryable) await this.retryOrFail(message.id, message.sendAttempts, error.code, error.safeMessage);
      else await this.fail(message.id, error.code, error.safeMessage);
    }
  }

  /** IDs com retentativa vencida (usado pelo worker). */
  async dueMessageIds(limit: number): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where: { deliveryStatus: "PENDING", nextSendAttemptAt: { lte: new Date() } },
      orderBy: { nextSendAttemptAt: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private assertSenderAllowed(sender: OutboundSender, mode: ConversationMode): void {
    if (sender.type === "AGENT" && !humanMayReply(mode)) {
      throw new ConflictException("Assuma o atendimento para responder manualmente.");
    }
    if (sender.type === "AI" && !aiMayReply(mode)) {
      throw new ConflictException("A IA só pode responder conversas no modo IA.");
    }
  }

  private async retryOrFail(id: string, attempts: number, code: string, message: string): Promise<void> {
    if (attempts >= MAX_ATTEMPTS) {
      await this.fail(id, code, `${message} Tentativas esgotadas.`);
      return;
    }
    await this.prisma.message.updateMany({
      where: { id, deliveryStatus: "PENDING" },
      data: { nextSendAttemptAt: new Date(Date.now() + backoffMs(attempts)), errorCode: code, errorMessage: message.slice(0, 500) },
    });
  }

  private async fail(id: string, code: string, message: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id, deliveryStatus: "PENDING" },
      data: {
        deliveryStatus: "FAILED",
        failedAt: new Date(),
        nextSendAttemptAt: null,
        errorCode: code.slice(0, 32),
        errorMessage: message.slice(0, 500),
      } satisfies Prisma.MessageUpdateManyMutationInput,
    });
  }
}
