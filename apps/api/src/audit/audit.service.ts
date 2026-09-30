import { Injectable } from "@nestjs/common";
import type { Prisma } from "@arthur-ai/database";
import { PrismaService } from "../prisma/prisma.service.js";

export const AUDIT_ACTIONS = {
  COMPANY_CREATED: "company.created",
  USER_CREATED: "user.created",
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  PASSWORD_CHANGED: "auth.password_changed",
} as const;
type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string | null;
  entityType: "User" | "Company" | "CompanyMember";
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
