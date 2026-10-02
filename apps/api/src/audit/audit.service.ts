import { Injectable } from "@nestjs/common";
import type { Prisma } from "@arthur-ai/database";
import { PrismaService } from "../prisma/prisma.service.js";

export const AUDIT_ACTIONS = {
  COMPANY_CREATED: "company.created",
  USER_CREATED: "user.created",
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  PASSWORD_CHANGED: "auth.password_changed",
  CONTACT_CREATED: "contact.created",
  CONTACT_UPDATED: "contact.updated",
  CONVERSATION_CREATED: "conversation.created",
  CONVERSATION_MODE_CHANGED: "conversation.mode_changed",
  WHATSAPP_ACCOUNT_CREATED: "whatsapp.account_created",
  WHATSAPP_ACCOUNT_UPDATED: "whatsapp.account_updated",
  WHATSAPP_ACCOUNT_TESTED: "whatsapp.account_tested",
  WHATSAPP_ACCOUNT_DISABLED: "whatsapp.account_disabled",
  WHATSAPP_ACCOUNT_ENABLED: "whatsapp.account_enabled",
  AI_SETTINGS_UPDATED: "ai.settings_updated",
  KNOWLEDGE_CREATED: "knowledge.created",
  KNOWLEDGE_UPDATED: "knowledge.updated",
  KNOWLEDGE_DELETED: "knowledge.deleted",
  CONVERSATION_AI_HANDOFF: "conversation.ai_handoff",
  // Fase 5
  MEMBER_ROLE_CHANGED: "team.member_role_changed",
  MEMBER_ACTIVATED: "team.member_activated",
  MEMBER_DEACTIVATED: "team.member_deactivated",
  MEMBER_LIMIT_CHANGED: "team.member_limit_changed",
  MEMBER_CAN_ATTEND_CHANGED: "team.member_can_attend_changed",
  MEMBER_AVAILABILITY_CHANGED: "team.availability_changed",
  TEAM_SETTINGS_UPDATED: "team.settings_updated",
  CONVERSATION_QUEUED: "conversation.queued",
  CONVERSATION_DEQUEUED: "conversation.dequeued",
  CONVERSATION_ASSIGNED: "conversation.assigned",
  CONVERSATION_TRANSFERRED: "conversation.transferred",
  CONVERSATION_CLOSED: "conversation.closed",
  CONVERSATION_REOPENED: "conversation.reopened",
} as const;
type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string | null;
  entityType: "User" | "Company" | "CompanyMember" | "Contact" | "Conversation" | "WhatsAppAccount" | "AiSettings" | "KnowledgeEntry" | "TeamSettings";
  entityId: string | null;
  companyId?: string | null;
  // Nunca inclua senhas, hashes ou tokens aqui.
  metadata?: Prisma.InputJsonObject;
}

type AuditClient = Pick<PrismaService, "auditLog"> | Prisma.TransactionClient;

/** Somente escrita nesta fase. Aceita um client de transação para gravar junto com a operação auditada. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: AuditClient = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        companyId: entry.companyId ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      },
    });
  }
}
