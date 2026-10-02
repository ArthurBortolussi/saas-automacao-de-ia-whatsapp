import { ConflictException, Injectable } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import { hashPassword } from "@arthur-ai/database/password";
import type {
  CompanyDetail,
  CompanyMemberItem,
  CompanySummary,
  CreateCompanyData,
  CreateCompanyMemberInput,
  ListCompaniesQuery,
  Paginated,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toCompanyDetail, toCompanySummary } from "./company.mapper.js";
import { firstFreeSlug, slugify } from "./slug.js";

const SLUG_ATTEMPTS = 10;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCompaniesQuery): Promise<Paginated<CompanySummary>> {
    const where = query.q ? { name: { contains: query.q, mode: "insensitive" as const } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);
    return { items: items.map(toCompanySummary), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * A garantia de unicidade é a constraint do banco: o SELECT só sugere um candidato.
   * Em corrida (duas criações simultâneas do mesmo nome), o INSERT perdedor recebe P2002 e tenta de novo.
   */
  async create(input: CreateCompanyData, actor: User): Promise<CompanyDetail> {
    const base = slugify(input.name);
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const taken = await this.prisma.company.findMany({
        where: { slug: { startsWith: base } },
        select: { slug: true },
      });
      const slug = firstFreeSlug(base, new Set(taken.map((company) => company.slug)));
      try {
        const company = await this.prisma.$transaction(async (tx) => {
          const created = await tx.company.create({ data: { ...input, slug, status: "ONBOARDING" } });
          await this.audit.record(
            {
              action: AUDIT_ACTIONS.COMPANY_CREATED,
              actorUserId: actor.id,
              entityType: "Company",
              entityId: created.id,
              companyId: created.id,
              metadata: { name: created.name, slug: created.slug },
            },
            tx,
          );
          return created;
        });
        return toCompanyDetail(company);
      } catch (error) {
        if (uniqueViolationIndex(error) !== "Company_slug_key") throw error;
      }
    }
    throw new ConflictException("Não foi possível gerar um identificador único. Tente novamente.");
  }

  async listMembers(company: Company): Promise<CompanyMemberItem[]> {
    const members = await this.prisma.companyMember.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, status: true, mustChangePassword: true } } },
    });
    return members.map((member) => ({
      id: member.id,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
      user: member.user,
    }));
  }

  /** Também usado pela aba Equipe (Fase 5): mesma senha provisória com troca obrigatória no primeiro acesso. */
  async createMember(
    company: Company,
    input: CreateCompanyMemberInput,
    actor: User,
    options: { maxConcurrent?: number; canAttend?: boolean } = {},
  ): Promise<CompanyMemberItem> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: input.name, email: input.email, passwordHash, globalRole: "USER", mustChangePassword: true },
        });
        const member = await tx.companyMember.create({
          data: { companyId: company.id, userId: user.id, role: input.role, ...options },
        });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.USER_CREATED,
            actorUserId: actor.id,
            entityType: "CompanyMember",
            entityId: member.id,
            companyId: company.id,
            metadata: { userId: user.id, email: user.email, role: member.role },
          },
          tx,
        );
        return {
          id: member.id,
          role: member.role,
          createdAt: member.createdAt.toISOString(),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
            mustChangePassword: user.mustChangePassword,
          },
        };
      });
    } catch (error) {
      if (uniqueViolationIndex(error) === "User_email_key") {
        throw new ConflictException("Já existe um usuário com este e-mail.");
      }
      throw error;
    }
  }
}
