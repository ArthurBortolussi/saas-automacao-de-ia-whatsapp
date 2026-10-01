import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import {
  conversationActionSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  uuidSchema,
  type ConversationActionInput,
  type ConversationDetail,
  type ConversationSummary,
  type CreateConversationInput,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageItem,
  type MessagePage,
  type Paginated,
  type SendMessageInput,
} from "@arthur-ai/shared";
import { CurrentCompany, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { ConversationsService } from "./conversations.service.js";

@Controller("companies/:companyId/conversations")
@UseGuards(CompanyAccessGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentCompany() company: Company,
    @Query({ schema: listConversationsQuerySchema }) query: ListConversationsQuery,
  ): Promise<Paginated<ConversationSummary>> {
    return this.conversations.list(company, query);
  }

  @Post()
  create(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @Body({ schema: createConversationSchema }) body: CreateConversationInput,
  ): Promise<ConversationDetail> {
    return this.conversations.create(company, body.contactId, actor);
  }

  @Get(":conversationId")
  get(
    @CurrentCompany() company: Company,
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
  ): Promise<ConversationDetail> {
    return this.conversations.get(company, conversationId);
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
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Body({ schema: sendMessageSchema }) body: SendMessageInput,
  ): Promise<MessageItem> {
    return this.conversations.send(company, conversationId, body.body, actor);
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
    @Param("conversationId", { schema: uuidSchema }) conversationId: string,
    @Body({ schema: conversationActionSchema }) body: ConversationActionInput,
  ): Promise<ConversationDetail> {
    return this.conversations.changeMode(company, conversationId, body.action, actor);
  }
}
