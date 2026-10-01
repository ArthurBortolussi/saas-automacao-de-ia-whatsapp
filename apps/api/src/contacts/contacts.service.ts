import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Company, type User } from "@arthur-ai/database";
import type {
  ContactDetail,
  ContactSummary,
  CreateContactData,
  ListContactsQuery,
  Paginated,
  UpdateContactData,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toContactDetail, toContactSummary } from "./contact.mapper.js";

const DUPLICATE_PHONE = "Já existe um contato com este telefone nesta empresa.";

/** Toda operação recebe a empresa já validada pelo CompanyAccessGuard e filtra por ela. */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(company: Company, query: ListContactsQuery): Promise<Paginated<ContactSummary>> {
    const where: Prisma.ContactWhereInput = { companyId: company.id };
    if (query.status) where.status = query.status;
    if (query.q) {
      const digits = query.q.replace(/\D/g, "");
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
        // Telefones são guardados só com dígitos: "(11) 9888" encontra "5511988887777".
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { items: items.map(toContactSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(company: Company, contactId: string): Promise<ContactDetail> {
    const contact = await this.prisma.contact.findUnique({ where: { id_companyId: { id: contactId, companyId: company.id } } });
    if (!contact) throw new NotFoundException("Contato não encontrado.");
    return toContactDetail(contact);
  }

  async create(company: Company, data: CreateContactData, actor: User): Promise<ContactDetail> {
    try {
      const contact = await this.prisma.$transaction(async (tx) => {
        const created = await tx.contact.create({ data: { ...data, companyId: company.id } });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.CONTACT_CREATED,
            actorUserId: actor.id,
            entityType: "Contact",
            entityId: created.id,
            companyId: company.id,
          },
          tx,
        );
        return created;
      });
      return toContactDetail(contact);
    } catch (error) {
      if (uniqueViolationIndex(error) === "Contact_companyId_phone_key") throw new ConflictException(DUPLICATE_PHONE);
      throw error;
    }
  }

  async update(company: Company, contactId: string, data: UpdateContactData, actor: User): Promise<ContactDetail> {
    try {
      const contact = await this.prisma.$transaction(async (tx) => {
        // A chave composta (id, companyId) garante que só se altera contato da empresa validada.
        const updated = await tx.contact.update({
          where: { id_companyId: { id: contactId, companyId: company.id } },
          data,
        });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.CONTACT_UPDATED,
            actorUserId: actor.id,
            entityType: "Contact",
            entityId: updated.id,
            companyId: company.id,
            metadata: { fields: Object.keys(data).filter((key) => data[key as keyof UpdateContactData] !== undefined) },
          },
          tx,
        );
        return updated;
      });
      return toContactDetail(contact);
    } catch (error) {
      if (uniqueViolationIndex(error) === "Contact_companyId_phone_key") throw new ConflictException(DUPLICATE_PHONE);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("Contato não encontrado.");
      }
      throw error;
    }
  }
}
