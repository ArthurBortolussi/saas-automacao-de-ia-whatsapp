import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Company, CompanyMember, KnowledgeEntry, Prisma, User } from "@arthur-ai/database";
import {
  KNOWLEDGE_MAX_ENTRIES,
  type CreateKnowledgeEntryData,
  type KnowledgeEntryItem,
  type KnowledgeListResponse,
  type ListKnowledgeQuery,
  type UpdateKnowledgeEntryData,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { canManageCompanyAi } from "./ai-access.js";

const NOT_FOUND = "Informação não encontrada.";

export function knowledgeChars(entries: { title: string; content: string; category: string | null }[]): number {
  return entries.reduce((sum, entry) => sum + entry.title.length + entry.content.length + (entry.category?.length ?? 0), 0);
}

function toItem(entry: KnowledgeEntry): KnowledgeEntryItem {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    active: entry.active,
    position: entry.position,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

/**
 * Base de conhecimento de UMA empresa (a validada pelo CompanyAccessGuard). Buscas por ID usam a chave
 * composta (id, companyId): ID de outra empresa resulta em 404. Quem só consulta (AGENT) vê apenas as ativas.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(company: Company, query: ListKnowledgeQuery, user: User, membership: CompanyMember | null): Promise<KnowledgeListResponse> {
    const canEdit = canManageCompanyAi(user, membership);
    const status = canEdit ? query.status : "active";
    const where: Prisma.KnowledgeEntryWhereInput = {
      companyId: company.id,
      ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { content: { contains: query.q, mode: "insensitive" } },
              { category: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.knowledgeEntry.findMany({
        where,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.knowledgeEntry.count({ where }),
    ]);
    return { items: items.map(toItem), page: query.page, pageSize: query.pageSize, total, canEdit };
  }

  async get(company: Company, entryId: string, user: User, membership: CompanyMember | null): Promise<KnowledgeEntryItem> {
    const entry = await this.prisma.knowledgeEntry.findUnique({ where: { id_companyId: { id: entryId, companyId: company.id } } });
    if (!entry || (!entry.active && !canManageCompanyAi(user, membership))) throw new NotFoundException(NOT_FOUND);
    return toItem(entry);
  }

  async create(company: Company, data: CreateKnowledgeEntryData, actor: User): Promise<KnowledgeEntryItem> {
    const entry = await this.prisma.$transaction(async (tx) => {
      const count = await tx.knowledgeEntry.count({ where: { companyId: company.id } });
      if (count >= KNOWLEDGE_MAX_ENTRIES) {
        throw new ConflictException(`Limite de ${KNOWLEDGE_MAX_ENTRIES} informações por empresa atingido. Exclua ou reúna entradas antigas.`);
      }
      const created = await tx.knowledgeEntry.create({
        data: {
          companyId: company.id,
          title: data.title,
          content: data.content,
          category: data.category ?? null,
          active: data.active,
          position: data.position,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KNOWLEDGE_CREATED,
          actorUserId: actor.id,
          entityType: "KnowledgeEntry",
          entityId: created.id,
          companyId: company.id,
        },
        tx,
      );
      return created;
    });
    return toItem(entry);
  }

  async update(company: Company, entryId: string, data: UpdateKnowledgeEntryData, actor: User): Promise<KnowledgeEntryItem> {
    const entry = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.knowledgeEntry.updateMany({
        where: { id: entryId, companyId: company.id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.content !== undefined ? { content: data.content } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
        },
      });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KNOWLEDGE_UPDATED,
          actorUserId: actor.id,
          entityType: "KnowledgeEntry",
          entityId: entryId,
          companyId: company.id,
          metadata: { fields: Object.keys(data) },
        },
        tx,
      );
      return tx.knowledgeEntry.findUniqueOrThrow({ where: { id_companyId: { id: entryId, companyId: company.id } } });
    });
    return toItem(entry);
  }

  async remove(company: Company, entryId: string, actor: User): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.knowledgeEntry.deleteMany({ where: { id: entryId, companyId: company.id } });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KNOWLEDGE_DELETED,
          actorUserId: actor.id,
          entityType: "KnowledgeEntry",
          entityId: entryId,
          companyId: company.id,
        },
        tx,
      );
    });
  }

  /** Entradas que a IA pode usar: só ATIVAS e só da empresa da conversa. */
  activeForAi(companyId: string) {
    return this.prisma.knowledgeEntry.findMany({
      where: { companyId, active: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { title: true, content: true, category: true },
    });
  }
}
