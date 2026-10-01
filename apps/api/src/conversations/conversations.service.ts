import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Company, ConversationMode, Prisma, User } from "@arthur-ai/database";
import {
  ACTION_ALLOWED_FROM,
  humanMayReply,
  type ConversationAction,
  type ConversationDetail,
  type ConversationSummary,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageItem,
  type MessagePage,
  type Paginated,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  messagePreview,
  toConversationDetail,
  toConversationSummary,
  toMessageItem,
  userRefSelect,
} from "./conversation.mapper.js";

const CONVERSATION_NOT_FOUND = "Conversa não encontrada.";
const CONCURRENT_CHANGE = "A conversa foi alterada por outra pessoa. Atualize a página e tente novamente.";

const FILTER_WHERE: Record<ListConversationsQuery["filter"], Prisma.ConversationWhereInput> = {
  all: {},
  ai: { mode: "AI" },
  human: { mode: "HUMAN" },
  paused: { mode: "PAUSED" },
  unread: { unreadCount: { gt: 0 } },
};

const INVALID_ACTION_MESSAGE: Record<ConversationAction, string> = {
  ASSUME: "A conversa já está com atendimento humano.",
  RETURN_TO_AI: "A conversa já está com a IA.",
  PAUSE: "A conversa já está pausada.",
  RESUME: "Só é possível reativar uma conversa pausada.",
};

/**
 * Conversas e mensagens. Toda query usa a empresa validada pelo CompanyAccessGuard;
 * as chaves compostas (id, companyId) fazem IDs de outras empresas simplesmente não existirem.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(company: Company, query: ListConversationsQuery): Promise<Paginated<ConversationSummary>> {
    const where: Prisma.ConversationWhereInput = {
      companyId: company.id,
      ...FILTER_WHERE[query.filter],
      ...(query.contactId ? { contactId: query.contactId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
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

  async get(company: Company, conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId: company.id } },
      include: { contact: true, assignedUser: userRefSelect },
    });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    return toConversationDetail(conversation);
  }

  /** Conversa iniciada pelo painel: é uma ação humana, então já nasce em HUMAN com o autor como responsável. */
  async create(company: Company, contactId: string, actor: User): Promise<ConversationDetail> {
    const contact = await this.prisma.contact.findUnique({ where: { id_companyId: { id: contactId, companyId: company.id } } });
    if (!contact) throw new NotFoundException("Contato não encontrado.");

    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: { companyId: company.id, contactId: contact.id, mode: "HUMAN", assignedUserId: actor.id },
        include: { contact: true, assignedUser: userRefSelect },
      });
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
    return toConversationDetail(conversation);
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

  /** Mensagem manual (interna nesta fase: não sai por nenhum canal). */
  async send(company: Company, conversationId: string, body: string, actor: User): Promise<MessageItem> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Condicional e atômico: se o modo mudou entre a tela e o envio, nada é gravado.
      const { count } = await tx.conversation.updateMany({
        where: { id: conversationId, companyId: company.id, mode: "HUMAN" },
        data: { lastMessageAt: now, lastMessagePreview: messagePreview(body), unreadCount: 0 },
      });
      if (count === 0) {
        const current = await tx.conversation.findUnique({
          where: { id_companyId: { id: conversationId, companyId: company.id } },
          select: { mode: true },
        });
        if (!current) throw new NotFoundException(CONVERSATION_NOT_FOUND);
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
  ): Promise<ConversationDetail> {
    const current = await this.requireConversation(company, conversationId);
    if (!ACTION_ALLOWED_FROM[action].includes(current.mode)) {
      throw new ConflictException(INVALID_ACTION_MESSAGE[action]);
    }
    const data = this.transition(action, current, actor);

    await this.prisma.$transaction(async (tx) => {
      // Concorrência otimista: só aplica se o modo ainda for o que foi lido.
      const { count } = await tx.conversation.updateMany({
        where: { id: conversationId, companyId: company.id, mode: current.mode },
        data,
      });
      if (count === 0) throw new ConflictException(CONCURRENT_CHANGE);
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
    return this.get(company, conversationId);
  }

  private transition(
    action: ConversationAction,
    current: { mode: ConversationMode; modeBeforePause: ConversationMode | null; assignedUserId: string | null },
    actor: User,
  ): { mode: ConversationMode; modeBeforePause: ConversationMode | null; assignedUserId?: string | null } {
    switch (action) {
      case "ASSUME":
        return { mode: "HUMAN", modeBeforePause: null, assignedUserId: actor.id };
      case "RETURN_TO_AI":
        return { mode: "AI", modeBeforePause: null, assignedUserId: null };
      case "PAUSE":
        return { mode: "PAUSED", modeBeforePause: current.mode };
      case "RESUME": {
        // Volta ao modo anterior à pausa; HUMAN sem responsável não faz sentido, então cai para AI.
        const restored = current.modeBeforePause ?? "AI";
        return restored === "HUMAN" && current.assignedUserId
          ? { mode: "HUMAN", modeBeforePause: null }
          : { mode: "AI", modeBeforePause: null, assignedUserId: null };
      }
    }
  }

  private async requireConversation(company: Company, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId: company.id } },
      select: { id: true, mode: true, modeBeforePause: true, assignedUserId: true },
    });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    return conversation;
  }
}
