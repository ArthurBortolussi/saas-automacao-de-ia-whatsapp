import { Controller, Get, UseGuards } from "@nestjs/common";
import type { Company } from "@arthur-ai/database";
import type { CompanyDetail } from "@arthur-ai/shared";
import { CurrentCompany } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toCompanyDetail } from "./company.mapper.js";

/** Área da empresa. Tudo aqui é tenant-scoped pelo CompanyAccessGuard. */
@Controller("companies/:companyId")
@UseGuards(CompanyAccessGuard)
export class CompanyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview(@CurrentCompany() company: Company): Promise<CompanyDetail> {
    const logo = await this.prisma.companyLogo.findUnique({ where: { companyId: company.id }, select: { updatedAt: true } });
    return toCompanyDetail(company, logo?.updatedAt ?? null);
  }
}
