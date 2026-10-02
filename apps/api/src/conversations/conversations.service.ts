import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Company, CompanyMember, ConversationMode, ConversationStatus, Prisma, User } from "@arthur-ai/database";
import {
  ACTION_ALLOWED_FROM,
  humanMayReply,
  type ConversationAction,
  type ConversationDetail,
  type ConversationSummary,
  type EligibleAssignee,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageItem,
  type MessagePage,
  type Paginated,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { endOpenAssignment, releasedData } from "../team/conversation-state.js";
import { DistributionService, isTeamManager } from "../team/distribution.service.js";
import { lockCompanyTeam } from "../team/team-lock.js";
import { WhatsAppOutboundService } from "../whatsapp/whatsapp-outbound.service.js";
import {
  messagePreview,
  toConversationDetail,
  toConversationSummary,
  toMessageItem,
  userRefSelect,
} from "./conversation.mapper.js";

const CONVERSATION_NOT_FOUND = "Conversa não encontrada.";
const CONCURRENT_CHANGE = "A conversa foi alterada por outra pessoa. Atualize a página e tente novamente.";
const CLOSED_MESSAGE = "Este atendimento foi finalizado. Ele será reaberto automaticamente quando o cliente escrever de novo.";
const OTHER_AGENT = "Esta conversa está com outro atendente.";

function filterWhere(filter: ListConversationsQuery["filter"], userId: string): Prisma.ConversationWhereInput {
  switch (filter) {
    case "all":
      return {};
    case "ai":
      return { mode: "AI" };
    case "human":
      return { mode: "HUMAN" };
    case "paused":
      return { mode: "PAUSED" };
    case "unread":
      return { unreadCount: { gt: 0 } };
    case "mine":
      return { status: "ASSIGNED", assignedUserId: userId };
    case "queued":
      return { status: "QUEUED" };
    case "unassigned":
      return { status: "OPEN", mode: { not: "AI" } };
    case "closed":
      return { status: "CLOSED" };
  }
}

const INVALID_ACTION_MESSAGE: Record<ConversationAction, string> = {
  ASSUME: "A conversa já está com atendimento humano.",
  RETURN_TO_AI: "A conversa já está com a IA.",
  PAUSE: "A conversa já está pausada.",
  RESUME: "Só é possível reativar uma conversa pausada.",
};

type CurrentRow = {
  id: string;
  mode: ConversationMode;
  status: ConversationStatus;
  modeBeforePause: ConversationMode | null;
  assignedUserId: string | null;
};

/**
 * Conversas e mensagens. Toda query usa a empresa validada pelo CompanyAccessGuard;
 * as chaves compostas (id, companyId) fazem IDs de outras empresas simplesmente não existirem.
 * Fase 5: o modo (quem pode responder) e o estado operacional (fila/atribuída/encerrada) são campos separados;
 * mudanças de atribuição acontecem sob a trava da empresa.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsapp: WhatsAppOutboundService,
    private readonly distribution: DistributionService,
  ) {}

  async list(company: Company, query: ListConversationsQuery, user: User): Promise<Paginated<ConversationSummary>> {
    const where: Prisma.ConversationWhereInput = {
      companyId: company.id,
      ...filterWhere(query.filter, user.id),
      ...(query.contactId ? { contactId: query.contactId } : {}),
    };
    // A fila é mostrada em ordem de chegada; as demais, pela última mensagem.
    const orderBy: Prisma.ConversationOrderByWithRelationInput[] =
      query.filter === "queued"
        ? [{ queuedAt: "asc" }, { id: "asc" }]
        : [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          contact: { select: { id: true, name: true, phone: true, status: true } },
          assignedUser: userRefSelect,
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return { items: items.map(toConversationSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(company: Company, conversationId: string, user: User, membership: CompanyMember | null): Promise<ConversationDetail> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId: company.id } },
      include: { contact: true, assignedUser: userRefSelect },
    });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    // Posição persistida: quantas conversas da MESMA empresa entraram antes na fila.
    const queuePosition =
      conversation.status === "QUEUED" && conversation.queuedAt
        ? (await this.prisma.conversation.count({
            where: {
              companyId: company.id,
              status: "QUEUED",
              OR: [
                { queuedAt: { lt: conversation.queuedAt } },
                { queuedAt: conversation.queuedAt, id: { lt: conversation.id } },
              ],
            },
          })) + 1
        : null;
    const manager = isTeamManager(membership);
    const mine = conversation.assignedUserId === user.id;
    const human = conversation.status !== "CLOSED" && conversation.mode !== "AI";
    return toConversationDetail(conversation, {
      queuePosition,
      permissions: {
        close: Boolean(membership) && human && (manager || mine),
        transfer: Boolean(membership) && human && conversation.mode === "HUMAN" && (manager || mine),
      },
    });
  }

  /** Conversa iniciada pelo painel: é uma ação humana, então já nasce em HUMAN com o autor como responsável. */
  async create(company: Company, contactId: string, actor: User, membership: CompanyMember | null): Promise<ConversationDetail> {
    const contact = await this.prisma.contact.findUnique({ where: { id_companyId: { id: contactId, companyId: company.id } } });
    if (!contact) throw new NotFoundException("Contato não encontrado.");

    const now = new Date();
    const conversation = await this.prisma.$transaction(async (tx) => {
      // Só membro da empresa pode ser responsável (o SUPERADMIN cria sem responsável).
      const owner = membership ? actor.id : null;
      const created = await tx.conversation.create({
        data: {
          companyId: company.id,
          contactId: contact.id,
          mode: "HUMAN",
          assignedUserId: owner,
          status: owner ? "ASSIGNED" : "OPEN",
          assignedAt: owner ? now : null,
          cycleStartedAt: now,
          lastActivityAt: now,
        },
      });
      if (owner) {
        await tx.conversationAssignment.create({
          data: { companyId: company.id, conversationId: created.id, userId: owner, startReason: "CREATED", actorUserId: actor.id, assignedAt: now },
        });
      }
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.CONVERSATION_CREATED,
          actorUserId: actor.id,
          entityType: "Conversation",
          entityId: created.id,
          companyId: company.id,
          metadata: { contactId: contact.id },
        },
        tx,
      );
      return created;
    });
    return this.get(company, conversation.id, actor, membership);
  }

  /** Paginação por cursor, da mais recente para a mais antiga; devolve em ordem cronológica. */
  async messages(company: Company, conversationId: string, query: ListMessagesQuery): Promise<MessagePage> {
    await this.requireConversation(company, conversationId);
    if (query.before) {
      // O cursor vem do cliente: só vale se for uma mensagem desta conversa, desta empresa.
      const cursor = await this.prisma.message.findFirst({
        where: { id: query.before, conversationId, companyId: company.id },
        select: { id: true },
      });
      if (!cursor) throw new BadRequestException("Cursor de paginação inválido.");
    }
    const rows = await this.prisma.message.findMany({
      where: { companyId: company.id, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      include: { sender: userRefSelect },
    });
    const hasMore = rows.length > query.limit;
    return { items: rows.slice(0, query.limit).reverse().map(toMessageItem), hasMore };
  }

  /** Mensagem manual. Conversa do WhatsApp sai pela Cloud API; conversa interna fica só no sistema. */
  async send(company: Company, conversationId: string, body: string, actor: User, membership: CompanyMember | null): Promise<MessageItem> {
    const target = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId: company.id } },
      select: { channel: true, status: true, assignedUserId: true },
    });
    if (!target) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    if (target.status === "CLOSED") throw new ConflictException(CLOSED_MESSAGE);
    // Atendimento de outro funcionário: só o responsável ou quem administra a equipe responde.
    if (target.status === "ASSIGNED" && target.assignedUserId !== actor.id && membership && !isTeamManager(membership)) {
      throw new ForbiddenException(OTHER_AGENT);
    }
    if (target.channel === "WHATSAPP") {
      return this.whatsapp.send(company, conversationId, body, { type: "AGENT", userId: actor.id });
    }
    return this.sendInternal(company, conversationId, body, actor);
  }

  private async sendInternal(company: Company, conversationId: string, body: string, actor: User): Promise<MessageItem> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Condicional e atômico: se o modo mudou entre a tela e o envio, nada é gravado.
      const { count } = await tx.conversation.updateMany({
        where: { id: conversationId, companyId: company.id, mode: "HUMAN", status: { not: "CLOSED" } },
        data: { lastMessageAt: now, lastMessagePreview: messagePreview(body), unreadCount: 0, lastActivityAt: now },
      });
      if (count === 0) {
        const current = await tx.conversation.findUnique({
          where: { id_companyId: { id: conversationId, companyId: company.id } },
          select: { mode: true, status: true },
        });
        if (!current) throw new NotFoundException(CONVERSATION_NOT_FOUND);
        if (current.status === "CLOSED") throw new ConflictException(CLOSED_MESSAGE);
        if (!humanMayReply(current.mode)) {
          throw new ConflictException("Assuma o atendimento para responder manualmente.");
        }
        throw new ConflictException(CONCURRENT_CHANGE);
      }
      const message = await tx.message.create({
        data: {
          companyId: company.id,
          conversationId,
          direction: "OUTBOUND",
          senderType: "AGENT",
          senderUserId: actor.id,
          body,
          createdAt: now,
        },
        include: { sender: userRefSelect },
      });
      return toMessageItem(message);
    });
  }

  async markRead(company: Company, conversationId: string): Promise<void> {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversationId, companyId: company.id },
      data: { unreadCount: 0 },
    });
    if (count === 0) throw new NotFoundException(CONVERSATION_NOT_FOUND);
  }

  async changeMode(
    company: Company,
    conversationId: string,
    action: ConversationAction,
    actor: User,
    membership: CompanyMember | null,
  ): Promise<ConversationDetail> {
    await this.requireConversation(company, conversationId);

    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const current = await tx.conversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: company.id } },
        select: { id: true, mode: true, status: true, modeBeforePause: true, assignedUserId: true },
      });
      if (current.status === "CLOSED") throw new ConflictException(CLOSED_MESSAGE);
      if (!ACTION_ALLOWED_FROM[action].includes(current.mode)) {
        throw new ConflictException(INVALID_ACTION_MESSAGE[action]);
      }
      // Atendimento de outro funcionário: AGENT não mexe; OWNER/ADMIN (e o SUPERADMIN) podem. Exceção (Fase 2):
      // "Assumir" uma conversa PAUSADA — ninguém a está atendendo — continua permitido, respeitando o limite.
      const takingPaused = action === "ASSUME" && current.mode === "PAUSED";
      if (current.status === "ASSIGNED" && current.assignedUserId !== actor.id && membership && !isTeamManager(membership) && !takingPaused) {
        throw new ForbiddenException(OTHER_AGENT);
      }
      const data = await this.transition(tx, company.id, action, current, actor, membership);

      // Concorrência otimista: só aplica se o modo e o estado ainda forem os que foram lidos.
      const { count } = await tx.conversation.updateMany({
        where: { id: conversationId, companyId: company.id, mode: current.mode, status: current.status },
        data,
      });
      if (count === 0) throw new ConflictException(CONCURRENT_CHANGE);
      await this.recordAssignmentChange(tx, company.id, action, current, actor, data);
      // Fase 4: qualquer troca de modo invalida o trabalho pendente da IA nesta conversa. Uma resposta em
      // geração não é enviada: o envio exige a tarefa ainda RUNNING, conferida na mesma transação da mensagem.
      await tx.aiReplyTask.updateMany({
        where: { conversationId, companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "CANCELED", outcome: "MODE_CHANGED", lockedUntil: null, finishedAt: new Date() },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.CONVERSATION_MODE_CHANGED,
          actorUserId: actor.id,
          entityType: "Conversation",
          entityId: conversationId,
          companyId: company.id,
          metadata: { action, from: current.mode, to: data.mode },
        },
        tx,
      );
    });
    // Devolver para a IA libera uma vaga; reativar pode devolver uma conversa à fila.
    await this.distribution.distribute(company.id);
    return this.get(company, conversationId, actor, membership);
  }

  /** Fase 5: transferência manual (regras e trava no DistributionService). */
  async transfer(company: Company, conversationId: string, toUserId: string, actor: User, membership: CompanyMember | null): Promise<ConversationDetail> {
    await this.distribution.transfer(company, conversationId, toUserId, actor, membership);
    return this.get(company, conversationId, actor, membership);
  }

  /** Fase 5: finalizar atendimento. */
  async close(company: Company, conversationId: string, actor: User, membership: CompanyMember | null): Promise<ConversationDetail> {
    await this.distribution.closeManually(company, conversationId, actor, membership);
    return this.get(company, conversationId, actor, membership);
  }

  /** Destinatários elegíveis para transferir esta conversa (sem o responsável atual). */
  async assignees(company: Company, conversationId: string): Promise<EligibleAssignee[]> {
    const conversation = await this.requireConversation(company, conversationId);
    return this.distribution.eligibleAssignees(company, conversation.assignedUserId);
  }

  private async transition(
    tx: Prisma.TransactionClient,
    companyId: string,
    action: ConversationAction,
    current: CurrentRow,
    actor: User,
    membership: CompanyMember | null,
  ): Promise<Prisma.ConversationUncheckedUpdateManyInput & { mode: ConversationMode }> {
    switch (action) {
      case "ASSUME": {
        // Só um funcionário da empresa pode ser o responsável; o limite dele vale também aqui.
        if (!membership) throw new ForbiddenException("Apenas funcionários da empresa podem assumir atendimentos.");
        if (current.assignedUserId !== actor.id) {
          const load = await tx.conversation.count({ where: { companyId, assignedUserId: actor.id, status: "ASSIGNED" } });
          const member = await tx.companyMember.findUniqueOrThrow({ where: { id: membership.id }, select: { maxConcurrent: true } });
          if (load >= member.maxConcurrent) throw new ConflictException("Você atingiu o seu limite de atendimentos simultâneos.");
        }
        const now = new Date();
        return {
          mode: "HUMAN",
          modeBeforePause: null,
          status: "ASSIGNED",
          assignedUserId: actor.id,
          assignedAt: now,
          queuedAt: null,
          queueNoticeAt: null,
          queueNoticeError: null,
          lastActivityAt: now,
        };
      }
      case "RETURN_TO_AI":
        // Sai da fila e de qualquer responsável; o aviso da última passagem automática deixa de valer.
        return { mode: "AI", modeBeforePause: null, ...releasedData, aiHandoffReason: null, aiHandoffAt: null };
      case "PAUSE":
        return { mode: "PAUSED", modeBeforePause: current.mode };
      case "RESUME": {
        // Volta ao modo anterior à pausa; HUMAN sem responsável nem fila não faz sentido, então cai para AI.
        const restored = current.modeBeforePause ?? "AI";
        const humanCycle = current.status === "ASSIGNED" || current.status === "QUEUED";
        return restored === "HUMAN" && humanCycle
          ? { mode: "HUMAN", modeBeforePause: null }
          : { mode: "AI", modeBeforePause: null, ...releasedData };
      }
    }
  }

  private async recordAssignmentChange(
    tx: Prisma.TransactionClient,
    companyId: string,
    action: ConversationAction,
    current: CurrentRow,
    actor: User,
    data: Prisma.ConversationUncheckedUpdateManyInput,
  ): Promise<void> {
    const now = new Date();
    if (action === "ASSUME" && current.assignedUserId !== actor.id) {
      if (current.assignedUserId) await endOpenAssignment(tx, current.id, "TRANSFERRED", now);
      await tx.conversationAssignment.create({
        data: { companyId, conversationId: current.id, userId: actor.id, startReason: "ASSUME", actorUserId: actor.id, assignedAt: now },
      });
      return;
    }
    if (data.status === "OPEN") {
      if (current.assignedUserId) await endOpenAssignment(tx, current.id, "RETURNED_TO_AI", now);
      if (current.status === "QUEUED") {
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.CONVERSATION_DEQUEUED,
            actorUserId: actor.id,
            entityType: "Conversation",
            entityId: current.id,
            companyId,
            metadata: { reason: "RETURNED_TO_AI" },
          },
          tx,
        );
      }
    }
  }

  private async requireConversation(company: Company, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId: company.id } },
      select: { id: true, mode: true, status: true, modeBeforePause: true, assignedUserId: true },
    });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    return conversation;
  }
}
