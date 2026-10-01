import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type MessageDeliveryStatus, type WhatsAppAccount } from "@arthur-ai/database";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { messagePreview } from "../conversations/conversation.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConversationEvents } from "./conversation-events.js";
import { phoneVariants } from "./phone-variants.js";
import {
  changeValueSchema,
  contactSchema,
  inboundMessageSchema,
  statusSchema,
  webhookEnvelopeSchema,
  type InboundMessagePayload,
  type StatusPayload,
} from "./webhook-payload.js";
import { WhatsAppAccountsService } from "./whatsapp-accounts.service.js";
import { classifyMetaError } from "./whatsapp-errors.js";

export type ProcessOutcome = { result: "processed" | "ignored"; companyId: string | null; retryLater: boolean };

/**
 * Status de entrega só avançam. Cada status de destino lista de quais estados ele pode vir;
 * eventos repetidos ou fora de ordem (ex.: "delivered" depois de "read") não fazem nada.
 */
const STATUS_ALLOWED_FROM: Record<Exclude<MessageDeliveryStatus, "PENDING">, MessageDeliveryStatus[]> = {
  SENT: ["PENDING"],
  DELIVERED: ["PENDING", "SENT"],
  READ: ["PENDING", "SENT", "DELIVERED"],
  FAILED: ["PENDING", "SENT"],
};

const META_STATUS: Record<string, Exclude<MessageDeliveryStatus, "PENDING">> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

const TIMESTAMP_FIELD = { SENT: "sentAt", DELIVERED: "deliveredAt", READ: "readAt", FAILED: "failedAt" } as const;

const MAX_BODY = 4000;

function inboundBody(message: InboundMessagePayload): string {
  const text =
    message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
  const trimmed = text?.trim();
  if (trimmed) return trimmed.slice(0, MAX_BODY);
  return `[Mensagem do tipo "${message.type}" recebida. Este tipo de conteúdo ainda não é exibido pelo Arthur AI.]`;
}

/** Timestamp da Meta (segundos). Valores absurdos (futuro distante) caem para "agora". */
function metaTime(seconds: string | undefined): Date {
  const now = Date.now();
  const value = seconds ? Number(seconds) * 1000 : NaN;
  return Number.isFinite(value) && value > 0 && value <= now + 5 * 60_000 ? new Date(value) : new Date(now);
}

function contactName(profileName: string | undefined, waId: string): string {
  // Nome vem do perfil do cliente (dado externo): remove controles e limita o tamanho.
  const clean = profileName?.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 120);
  return clean && clean.length >= 1 ? clean : `+${waId}`;
}

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: WhatsAppAccountsService,
    private readonly events: ConversationEvents,
  ) {}

  /**
   * Processa um payload já autenticado. Idempotente: reprocessar o mesmo payload não duplica nada.
   * `retryLater` indica status de uma mensagem que ainda não conhecemos (possível corrida com o envio).
   */
  async process(payload: unknown): Promise<ProcessOutcome> {
    const envelope = webhookEnvelopeSchema.safeParse(payload);
    if (!envelope.success || envelope.data.object !== "whatsapp_business_account") {
      return { result: "ignored", companyId: null, retryLater: false };
    }
    let companyId: string | null = null;
    let handled = false;
    let retryLater = false;

    for (const entry of envelope.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;
        const value = changeValueSchema.safeParse(change.value);
        if (!value.success) continue;

        const account = await this.accounts.findByPhoneNumberId(value.data.metadata.phone_number_id);
        if (!account) {
          this.logger.warn("Webhook para um phone_number_id não cadastrado: ignorado.");
          continue;
        }
        companyId ??= account.companyId;
        if (account.status === "DISABLED") continue;
        handled = true;

        const profiles = new Map<string, string | undefined>();
        for (const raw of value.data.contacts ?? []) {
          const contact = contactSchema.safeParse(raw);
          if (contact.success) profiles.set(contact.data.wa_id, contact.data.profile?.name);
        }
        for (const raw of value.data.messages ?? []) {
          const message = inboundMessageSchema.safeParse(raw);
          if (message.success) await this.handleInbound(account, message.data, profiles.get(message.data.from));
        }
        for (const raw of value.data.statuses ?? []) {
          const status = statusSchema.safeParse(raw);
          if (status.success && !(await this.handleStatus(account.companyId, status.data))) retryLater = true;
        }
      }
    }
    return { result: handled ? "processed" : "ignored", companyId, retryLater };
  }

  private async handleInbound(account: WhatsAppAccount, message: InboundMessagePayload, profileName: string | undefined): Promise<void> {
    const companyId = account.companyId;
    // Atalho de idempotência (a garantia real é o índice único companyId+externalId).
    const already = await this.prisma.message.findUnique({
      where: { companyId_externalId: { companyId, externalId: message.id } },
      select: { id: true },
    });
    if (already) return;

    const at = metaTime(message.timestamp);
    const body = inboundBody(message);
    let created: { conversationId: string; messageId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const contact = await this.findOrCreateContact(tx, companyId, message.from, profileName);
        const conversation =
          (await tx.conversation.findFirst({
            where: { companyId, contactId: contact.id, channel: "WHATSAPP" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          })) ?? (await tx.conversation.create({ data: { companyId, contactId: contact.id, channel: "WHATSAPP" }, select: { id: true } }));

        const row = await tx.message.create({
          data: {
            companyId,
            conversationId: conversation.id,
            direction: "INBOUND",
            senderType: "CONTACT",
            body,
            externalId: message.id,
            externalType: message.type,
            createdAt: at,
          },
          select: { id: true },
        });
        await tx.conversation.update({ where: { id: conversation.id }, data: { unreadCount: { increment: 1 } } });
        // Mensagens podem chegar fora de ordem: só avança "última mensagem"/janela se esta for mais nova.
        await tx.conversation.updateMany({
          where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: at } }] },
          data: { lastMessageAt: at, lastMessagePreview: messagePreview(body) },
        });
        await tx.conversation.updateMany({
          where: { id: conversation.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
          data: { lastInboundAt: at },
        });
        return { conversationId: conversation.id, messageId: row.id };
      });
    } catch (error) {
      // Corrida com outro processamento do mesmo evento: a outra transação já gravou.
      if (uniqueViolationIndex(error) === "Message_companyId_externalId_key") return;
      throw error;
    }
    this.events.emitInboundMessage({ companyId, ...created });
  }

  private async findOrCreateContact(tx: Prisma.TransactionClient, companyId: string, waId: string, profileName: string | undefined) {
    const byWaId = await tx.contact.findUnique({ where: { companyId_whatsappId: { companyId, whatsappId: waId } }, select: { id: true } });
    if (byWaId) return byWaId;

    // Contato cadastrado à mão (talvez com/sem o 9º dígito): vincula o wa_id em vez de duplicar.
    const byPhone = await tx.contact.findFirst({
      where: { companyId, phone: { in: phoneVariants(waId) }, whatsappId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (byPhone) {
      await tx.contact.update({ where: { id: byPhone.id }, data: { whatsappId: waId } });
      return byPhone;
    }
    // Mesmo telefone já em uso por um contato ligado a outro wa_id: reutiliza, sem sobrescrever o vínculo.
    const samePhone = await tx.contact.findUnique({ where: { companyId_phone: { companyId, phone: waId } }, select: { id: true } });
    if (samePhone) return samePhone;
    return tx.contact.create({
      data: { companyId, name: contactName(profileName, waId), phone: waId, whatsappId: waId, source: "WHATSAPP" },
      select: { id: true },
    });
  }

  /** Devolve false se a mensagem ainda não é conhecida (vale tentar de novo mais tarde). */
  private async handleStatus(companyId: string, status: StatusPayload): Promise<boolean> {
    const target = META_STATUS[status.status];
    if (!target) return true; // status desconhecido/não suportado: ignorado com segurança

    const message = await this.prisma.message.findUnique({
      // companyId do número que recebeu o webhook: um wamid de outra empresa nunca casa.
      where: { companyId_externalId: { companyId, externalId: status.id } },
      select: { id: true },
    });
    if (!message) return false;

    const at = metaTime(status.timestamp);
    const error = target === "FAILED" ? classifyMetaError(status.errors?.[0]?.code, 400) : null;
    await this.prisma.message.updateMany({
      where: { id: message.id, deliveryStatus: { in: STATUS_ALLOWED_FROM[target] } },
      data: {
        deliveryStatus: target,
        [TIMESTAMP_FIELD[target]]: at,
        ...(error ? { errorCode: error.code, errorMessage: error.safeMessage, nextSendAttemptAt: null } : {}),
      },
    });
    return true;
  }
}
