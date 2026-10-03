import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type ConversationMode, type ConversationStatus, type MessageDeliveryStatus, type WhatsAppAccount } from "@arthur-ai/database";
import { aiMayReply } from "@arthur-ai/shared";
import { markQueued, startCycle } from "../analytics/cycle-tracker.js";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { messagePreview } from "../conversations/conversation.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { businessClosedPeriod, companyBlockedForShare, loadCompanyRuntime, type CompanyRuntime } from "../settings/runtime.js";
import { queuedData, releasedData } from "../team/conversation-state.js";
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
import { WhatsAppOutboundService } from "./whatsapp-outbound.service.js";

export type ProcessOutcome = {
  result: "processed" | "ignored";
  companyId: string | null;
  retryLater: boolean;
  /** Fase 7: mensagens descartadas (ex.: COMPANY_SUSPENDED). O evento nunca é reprocessado. */
  ignoredReason: string | null;
};

/** Mensagem recebida para uma empresa suspensa: nada é gravado. */
const DISCARDED = "COMPANY_SUSPENDED";

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

/** Modo das conversas novas/reabertas. Fase 7: com a IA pausada pela empresa, o cliente vai para a equipe. */
async function defaultConversationMode(tx: Prisma.TransactionClient, companyId: string, runtime: CompanyRuntime): Promise<ConversationMode> {
  const settings = await tx.aiSettings.findUnique({ where: { companyId }, select: { defaultConversationMode: true } });
  const mode = settings?.defaultConversationMode ?? "AI";
  return mode === "AI" && runtime.aiPaused ? "HUMAN" : mode;
}

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: WhatsAppAccountsService,
    private readonly events: ConversationEvents,
    private readonly audit: AuditService,
    private readonly outbound: WhatsAppOutboundService,
  ) {}

  /**
   * Processa um payload já autenticado. Idempotente: reprocessar o mesmo payload não duplica nada.
   * `retryLater` indica status de uma mensagem que ainda não conhecemos (possível corrida com o envio).
   */
  async process(payload: unknown): Promise<ProcessOutcome> {
    const envelope = webhookEnvelopeSchema.safeParse(payload);
    if (!envelope.success || envelope.data.object !== "whatsapp_business_account") {
      return { result: "ignored", companyId: null, retryLater: false, ignoredReason: null };
    }
    let companyId: string | null = null;
    let handled = false;
    let retryLater = false;
    let discarded = false;
    let worked = false;

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
          if (!message.success) continue;
          if ((await this.handleInbound(account, message.data, profiles.get(message.data.from))) === "discarded") discarded = true;
          else worked = true;
        }
        // Status de entrega só atualizam mensagens já existentes (histórico); continuam valendo na suspensão.
        for (const raw of value.data.statuses ?? []) {
          const status = statusSchema.safeParse(raw);
          if (!status.success) continue;
          worked = true;
          if (!(await this.handleStatus(account.companyId, status.data))) retryLater = true;
        }
      }
    }
    return {
      // Evento só com mensagens descartadas fica IGNORED (com o motivo), nunca PROCESSED.
      result: handled && (worked || !discarded) ? "processed" : "ignored",
      companyId,
      retryLater,
      ignoredReason: discarded ? DISCARDED : null,
    };
  }

  /**
   * Fase 7: empresa suspensa → a mensagem é DESCARTADA (nada de contato, conversa, mensagem, fila ou resposta) e
   * não é recuperada depois da reativação. A checagem é feita na transação, com a linha da empresa travada para
   * leitura: um evento que já estava na fila quando a suspensão foi gravada também é descartado.
   */
  private async handleInbound(
    account: WhatsAppAccount,
    message: InboundMessagePayload,
    profileName: string | undefined,
  ): Promise<"stored" | "duplicate" | "discarded"> {
    const companyId = account.companyId;
    // Atalho de idempotência (a garantia real é o índice único companyId+externalId).
    const already = await this.prisma.message.findUnique({
      where: { companyId_externalId: { companyId, externalId: message.id } },
      select: { id: true },
    });
    if (already) return "duplicate";

    const at = metaTime(message.timestamp);
    const body = inboundBody(message);
    let created: { conversationId: string; messageId: string; queued: boolean; outbox: string[] } | null;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (await companyBlockedForShare(tx, companyId)) return null;
        const runtime = await loadCompanyRuntime(tx, companyId);
        const contact = await this.findOrCreateContact(tx, companyId, message.from, profileName);
        // Fase 7: primeiro contato do cliente com a empresa (gravado uma única vez; reenvio do webhook desfaz tudo).
        const firstContact = (await tx.contact.updateMany({ where: { id: contact.id, welcomeHandledAt: null }, data: { welcomeHandledAt: new Date() } })).count === 1;
        const conversation = await this.conversationForInbound(tx, companyId, contact.id, runtime);

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
        // Fase 5: mensagem do cliente é atividade relevante (adia o encerramento por inatividade).
        await tx.conversation.update({ where: { id: conversation.id }, data: { unreadCount: { increment: 1 }, lastActivityAt: new Date() } });
        // Mensagens podem chegar fora de ordem: só avança "última mensagem"/janela se esta for mais nova.
        await tx.conversation.updateMany({
          where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: at } }] },
          data: { lastMessageAt: at, lastMessagePreview: messagePreview(body) },
        });
        await tx.conversation.updateMany({
          where: { id: conversation.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
          data: { lastInboundAt: at },
        });
        // Fase 4: tarefa da IA gravada junto com a mensagem (persistente; sobrevive a quedas da API).
        // Só em modo IA: mensagens recebidas com humano ou pausa nunca geram resposta automática depois.
        if (aiMayReply(conversation.mode)) {
          await tx.aiReplyTask.create({ data: { companyId, conversationId: conversation.id, messageId: row.id } });
        }
        const outbox = await this.automaticMessages(tx, runtime, conversation.id, firstContact, at);
        return { conversationId: conversation.id, messageId: row.id, queued: conversation.queued, outbox };
      });
    } catch (error) {
      // Corrida com outro processamento do mesmo evento: a outra transação já gravou.
      if (uniqueViolationIndex(error) === "Message_companyId_externalId_key") return "duplicate";
      throw error;
    }
    if (!created) return "discarded";
    // Na ordem em que foram gravadas (boas-vindas antes do aviso de fora do expediente); falhas seguem o outbox.
    for (const messageId of created.outbox) await this.outbound.dispatch(messageId);
    this.events.emitInboundMessage({ companyId, conversationId: created.conversationId, messageId: created.messageId });
    if (created.queued) this.events.emitHumanQueued(companyId);
    return "stored";
  }

  /**
   * Fase 7: mensagens automáticas do recebimento, gravadas na MESMA transação da mensagem do cliente (exatamente
   * uma vez, mesmo com webhooks repetidos ou simultâneos — a linha da conversa está travada):
   * 1. boas-vindas: só no primeiro contato do cliente com a empresa;
   * 2. fora do expediente: pelo horário GERAL do negócio (não o da IA nem o da equipe), uma vez por período fechado
   *    contínuo (identificado pelo fim da última abertura), mesmo que a IA continue respondendo.
   */
  private async automaticMessages(
    tx: Prisma.TransactionClient,
    runtime: CompanyRuntime,
    conversationId: string,
    firstContact: boolean,
    at: Date,
  ): Promise<string[]> {
    const outbox: string[] = [];
    if (firstContact && runtime.messages.welcome.enabled) {
      const result = await this.outbound.enqueueSystemInTx(tx, runtime.companyId, conversationId, runtime.messages.welcome.text);
      if ("messageId" in result) outbox.push(result.messageId);
    }
    if (runtime.messages.afterHours.enabled) {
      const period = businessClosedPeriod(runtime, at);
      if (period) {
        const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { afterHoursNoticeKey: true } });
        if (current.afterHoursNoticeKey !== period) {
          const result = await this.outbound.enqueueSystemInTx(tx, runtime.companyId, conversationId, runtime.messages.afterHours.text);
          if ("messageId" in result) {
            outbox.push(result.messageId);
            await tx.conversation.update({ where: { id: conversationId }, data: { afterHoursNoticeKey: period } });
          }
        }
      }
    }
    return outbox;
  }

  /**
   * Conversa que recebe a mensagem (mesma conversa por contato: o histórico é preservado). Fase 5:
   * - nova: nasce no modo padrão da empresa; se for HUMAN, já entra na fila;
   * - encerrada: reabre num ciclo novo no modo padrão (IA, ou fila humana), sem o responsável antigo;
   * - humana antiga sem responsável (dados de antes da Fase 5): entra na fila agora que o cliente escreveu.
   * A linha da conversa é travada (FOR UPDATE): um encerramento simultâneo espera ou já foi visto, e a mesma
   * mensagem reenviada pela Meta não reabre nada (o wamid já existe e a transação inteira é desfeita).
   */
  private async conversationForInbound(
    tx: Prisma.TransactionClient,
    companyId: string,
    contactId: string,
    runtime: CompanyRuntime,
  ): Promise<{ id: string; mode: ConversationMode; queued: boolean }> {
    const now = new Date();
    const existing = await tx.conversation.findFirst({
      where: { companyId, contactId, channel: "WHATSAPP" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!existing) {
      const mode = await defaultConversationMode(tx, companyId, runtime);
      const human = mode === "HUMAN";
      const conversation = await tx.conversation.create({
        data: { companyId, contactId, channel: "WHATSAPP", mode, cycleStartedAt: now, lastActivityAt: now, ...(human ? queuedData(now) : {}) },
        select: { id: true },
      });
      // Fase 6: ciclo de atendimento na mesma transação (um reenvio do webhook desfaz tudo junto).
      await startCycle(tx, { companyId, conversationId: conversation.id, origin: "NEW_CONVERSATION", mode, at: now });
      if (human) {
        await markQueued(tx, conversation.id, now);
        await this.recordQueued(tx, companyId, conversation.id, "NEW_CONVERSATION");
      }
      return { id: conversation.id, mode, queued: human };
    }

    const [current] = await tx.$queryRaw<{ mode: ConversationMode; status: ConversationStatus }[]>`
      SELECT "mode", "status" FROM "Conversation" WHERE "id" = ${existing.id}::uuid FOR UPDATE`;
    if (!current) throw new Error("Conversa sumiu durante o recebimento.");

    if (current.status === "CLOSED") {
      const mode = await defaultConversationMode(tx, companyId, runtime);
      const human = mode === "HUMAN";
      await tx.conversation.update({
        where: { id: existing.id },
        data: {
          mode,
          modeBeforePause: null,
          ...(human ? queuedData(now) : releasedData),
          closedAt: null,
          closeReason: null,
          closedByUserId: null,
          aiHandoffReason: null,
          aiHandoffAt: null,
          cycleStartedAt: now,
        },
      });
      await this.audit.record(
        { action: AUDIT_ACTIONS.CONVERSATION_REOPENED, actorUserId: null, entityType: "Conversation", entityId: existing.id, companyId, metadata: { mode } },
        tx,
      );
      // Novo ciclo na mesma conversa: o ciclo anterior continua encerrado (e contado) no período em que encerrou.
      await startCycle(tx, { companyId, conversationId: existing.id, origin: "REOPENED", mode, at: now });
      if (human) {
        await markQueued(tx, existing.id, now);
        await this.recordQueued(tx, companyId, existing.id, "REOPENED");
      }
      return { id: existing.id, mode, queued: human };
    }

    // Fase 7: IA pausada pela empresa → a nova mensagem segue para a equipe (fila), sem resposta automática.
    if (current.mode === "AI" && current.status === "OPEN" && runtime.aiPaused) {
      await tx.conversation.update({
        where: { id: existing.id },
        data: { mode: "HUMAN", modeBeforePause: null, aiHandoffReason: "AI_PAUSED", aiHandoffAt: now, ...queuedData(now) },
      });
      await markQueued(tx, existing.id, now);
      await this.recordQueued(tx, companyId, existing.id, "AI_PAUSED");
      return { id: existing.id, mode: "HUMAN", queued: true };
    }

    if (current.mode === "HUMAN" && current.status === "OPEN") {
      await tx.conversation.update({ where: { id: existing.id }, data: queuedData(now) });
      await markQueued(tx, existing.id, now);
      await this.recordQueued(tx, companyId, existing.id, "CUSTOMER_MESSAGE");
      return { id: existing.id, mode: current.mode, queued: true };
    }
    return { id: existing.id, mode: current.mode, queued: false };
  }

  private recordQueued(tx: Prisma.TransactionClient, companyId: string, conversationId: string, reason: string): Promise<void> {
    return this.audit.record(
      { action: AUDIT_ACTIONS.CONVERSATION_QUEUED, actorUserId: null, entityType: "Conversation", entityId: conversationId, companyId, metadata: { reason } },
      tx,
    );
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
