import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { detectLogoType, LOGO_MAX_BYTES, type LogoContentType } from "./logo.js";
import { requireOwner } from "./settings-access.js";

export interface StoredLogo {
  contentType: string;
  data: Uint8Array;
  sha256: string;
  updatedAt: Date;
}

/**
 * FASE 7: logotipo guardado no PostgreSQL (uma linha por empresa). Sobrevive a reinícios, não depende de disco local
 * nem de URL temporária e funciona com várias instâncias. Isolamento: a chave é o companyId do CompanyAccessGuard;
 * o arquivo nunca é servido por nome. Um upload inválido não toca no logotipo atual (validação antes da gravação,
 * gravação numa única operação).
 */
@Injectable()
export class LogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(company: Company): Promise<StoredLogo> {
    const logo = await this.prisma.companyLogo.findUnique({
      where: { companyId: company.id },
      select: { contentType: true, data: true, sha256: true, updatedAt: true },
    });
    if (!logo) throw new NotFoundException("A empresa não tem logotipo.");
    return logo;
  }

  async upload(company: Company, body: unknown, declaredType: string | undefined, actor: User, membership: CompanyMember | null): Promise<{ logoVersion: string }> {
    requireOwner(membership, "alterar o logotipo");
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException("Envie a imagem do logotipo (PNG, JPEG ou WEBP).");
    }
    if (body.length > LOGO_MAX_BYTES) throw new PayloadTooLargeException("O logotipo deve ter no máximo 512 KB.");
    const detected = detectLogoType(body);
    if (!detected) throw new BadRequestException("Formato não aceito. Use PNG, JPEG ou WEBP.");
    if (declaredType?.split(";")[0]?.trim().toLowerCase() !== detected) {
      throw new BadRequestException("O conteúdo do arquivo não corresponde ao tipo informado.");
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const data = new Uint8Array(body);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.companyLogo.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, contentType: detected satisfies LogoContentType, data, sizeBytes: body.length, sha256, updatedByUserId: actor.id },
        update: { contentType: detected, data, sizeBytes: body.length, sha256, updatedByUserId: actor.id },
        select: { updatedAt: true },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.COMPANY_LOGO_UPDATED,
          actorUserId: actor.id,
          entityType: "Company",
          entityId: company.id,
          companyId: company.id,
          metadata: { contentType: detected, sizeBytes: body.length, sha256 },
        },
        tx,
      );
      return row;
    });
    return { logoVersion: String(saved.updatedAt.getTime()) };
  }

  async remove(company: Company, actor: User, membership: CompanyMember | null): Promise<void> {
    requireOwner(membership, "remover o logotipo");
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.companyLogo.deleteMany({ where: { companyId: company.id } });
      if (count === 0) throw new NotFoundException("A empresa não tem logotipo.");
      await this.audit.record(
        { action: AUDIT_ACTIONS.COMPANY_LOGO_REMOVED, actorUserId: actor.id, entityType: "Company", entityId: company.id, companyId: company.id },
        tx,
      );
    });
  }
}
