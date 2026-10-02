import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import {
  conversationActionSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  transferConversationSchema,
  uuidSchema,
  type ConversationActionInput,
  type ConversationDetail,
  type ConversationSummary,
  type CreateConversationInput,
  type EligibleAssignee,
  type TransferConversationInput,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageItem,
  type MessagePage,
  type Paginated,
  type SendMessageInput,
} from "@arthur-ai/shared";
import { CurrentCompany, CurrentMembership, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { ConversationsService } from "./conversations.service.js";

@Controller("companies/:companyId/conversations")
@UseGuards(CompanyAccessGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Query({ schema: listConversationsQuerySchema }) query: ListConversationsQuery,
  ): Promise<Paginated<ConversationSummary>> {
    return this.conversations.list(company, query, user);
  }

  @Post()
  create(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: createConversationSchema }) body: CreateConversationInput,
  ): Promise<ConversationDetail> {
    return this.conversations.create(company, body.contactId, actor, membership);
  }

  @Get(":conversationId")
  get(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
  ): Promise<ConversationDetail> {
    return this.conversations.get(company, conversationId, user, membership);
  }

  @Get(":conversationId/messages")
  messages(
    @CurrentCompany() company: Company,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Query({ schema: listMessagesQuerySchema }) query: ListMessagesQuery,
  ): Promise<MessagePage> {
    return this.conversations.messages(company, conversationId, query);
  }

  @Post(":conversationId/messages")
  send(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Body({ schema: sendMessageSchema }) body: SendMessageInput,
  ): Promise<MessageItem> {
    return this.conversations.send(company, conversationId, body.body, actor, membership);
  }

  @Post(":conversationId/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @CurrentCompany() company: Company,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
  ): Promise<void> {
    return this.conversations.markRead(company, conversationId);
  }

  @Post(":conversationId/mode")
  @HttpCode(HttpStatus.OK)
  changeMode(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Body({ schema: conversationActionSchema }) body: ConversationActionInput,
  ): Promise<ConversationDetail> {
    return this.conversations.changeMode(company, conversationId, body.action, actor, membership);
  }

  /** Fase 5: finalizar atendimento (responsável ou OWNER/ADMIN). */
  @Post(":conversationId/close")
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
  ): Promise<ConversationDetail> {
    return this.conversations.close(company, conversationId, actor, membership);
  }

  /** Fase 5: transferir para outro funcionário (responsável ou OWNER/ADMIN). */
  @Post(":conversationId/transfer")
  @HttpCode(HttpStatus.OK)
  transfer(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Body({ schema: transferConversationSchema }) body: TransferConversationInput,
  ): Promise<ConversationDetail> {
    return this.conversations.transfer(company, conversationId, body.toUserId, actor, membership);
  }

  /** Fase 5: quem pode receber esta conversa agora (a transferência confere tudo de novo). */
  @Get(":conversationId/assignees")
  assignees(
    @CurrentCompany() company: Company,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
  ): Promise<EligibleAssignee[]> {
    return this.conversations.assignees(company, conversationId);
  }
}
