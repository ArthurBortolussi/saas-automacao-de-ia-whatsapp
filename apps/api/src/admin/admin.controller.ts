import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import {
  createCompanyMemberSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  listUsersQuerySchema,
  type AdminDashboardResponse,
  type AdminUserItem,
  type CompanyDetail,
  type CompanyMemberItem,
  type CompanySummary,
  type CreateCompanyData,
  type CreateCompanyMemberInput,
  type ListCompaniesQuery,
  type ListUsersQuery,
  type Paginated,
} from "@arthur-ai/shared";
import { CurrentCompany, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { SuperadminGuard } from "../common/guards/superadmin.guard.js";
import { toCompanyDetail } from "../companies/company.mapper.js";
import { CompaniesService } from "../companies/companies.service.js";
import { AdminService } from "./admin.service.js";

@Controller("admin")
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly companies: CompaniesService,
  ) {}

  @Get("dashboard")
  dashboard(): Promise<AdminDashboardResponse> {
    return this.admin.dashboard();
  }

  @Get("users")
  users(@Query({ schema: listUsersQuerySchema }) query: ListUsersQuery): Promise<Paginated<AdminUserItem>> {
    return this.admin.listUsers(query);
  }

  @Get("companies")
  listCompanies(
    @Query({ schema: listCompaniesQuerySchema }) query: ListCompaniesQuery,
  ): Promise<Paginated<CompanySummary>> {
    return this.companies.list(query);
  }

  @Post("companies")
  createCompany(
    @Body({ schema: createCompanySchema }) body: CreateCompanyData,
    @CurrentUser() actor: User,
  ): Promise<CompanyDetail> {
    return this.companies.create(body, actor);
  }

  // As rotas abaixo passam pela mesma resolução de tenant das rotas de empresa.
  @Get("companies/:companyId")
  @UseGuards(CompanyAccessGuard)
  company(@CurrentCompany() company: Company): CompanyDetail {
    return toCompanyDetail(company);
  }

  @Get("companies/:companyId/members")
  @UseGuards(CompanyAccessGuard)
  members(@CurrentCompany() company: Company): Promise<CompanyMemberItem[]> {
    return this.companies.listMembers(company);
  }

  @Post("companies/:companyId/members")
  @UseGuards(CompanyAccessGuard)
  createMember(
    @CurrentCompany() company: Company,
    @Body({ schema: createCompanyMemberSchema }) body: CreateCompanyMemberInput,
    @CurrentUser() actor: User,
  ): Promise<CompanyMemberItem> {
    return this.companies.createMember(company, body, actor);
  }
}
