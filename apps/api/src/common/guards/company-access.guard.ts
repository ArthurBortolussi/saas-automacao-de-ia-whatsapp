import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { API_ERROR_CODES, type MemberRole } from "@arthur-ai/shared";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service.js";
import { COMPANY_ROLES } from "../decorators/company-roles.decorator.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUSPENDED_STATUSES = new Set(["PAUSED", "INACTIVE"]);

/**
 * Resolução central de tenant. Toda rota com :companyId deve usar este guard.
 * O companyId da URL nunca é prova de acesso: o vínculo (userId, companyId) é conferido no banco.
 * Não depende da unicidade de CompanyMember.userId, então funciona igual com N:N.
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.auth?.user;
    if (!user) throw new ForbiddenException();

    const companyId = request.params["companyId"];
    if (typeof companyId !== "string") throw new Error("CompanyAccessGuard exige o parâmetro :companyId.");

    if (user.globalRole === "SUPERADMIN") {
      const company = UUID_PATTERN.test(companyId)
        ? await this.prisma.company.findUnique({ where: { id: companyId } })
        : null;
      if (!company) throw new NotFoundException("Empresa não encontrada.");
      const membership = await this.prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: user.id } },
      });
      request.tenant = { company, membership };
      return true;
    }

    // Para não-SUPERADMIN, empresa inexistente e empresa alheia respondem igual (403): não vaza existência.
    const membership = UUID_PATTERN.test(companyId)
      ? await this.prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId, userId: user.id } },
          include: { company: true },
        })
      : null;
    if (!membership) throw new ForbiddenException("Você não tem acesso a esta empresa.");

    if (SUSPENDED_STATUSES.has(membership.company.status)) {
      throw new ForbiddenException({
        message: "Acesso suspenso. Contate o suporte.",
        code: API_ERROR_CODES.COMPANY_SUSPENDED,
      });
    }

    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(COMPANY_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(membership.role)) {
      throw new ForbiddenException("Sua função não permite esta ação.");
    }

    const { company, ...member } = membership;
    request.tenant = { company, membership: member };
    return true;
  }
}
