import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import {
  updateWhatsAppAccountSchema,
  whatsappAccountActionSchema,
  type UpdateWhatsAppAccountData,
  type WhatsAppAccountAction,
  type WhatsAppAdminResponse,
  type WhatsAppCompanyStatus,
} from "@arthur-ai/shared";
import { CurrentCompany, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { SuperadminGuard } from "../common/guards/superadmin.guard.js";
import { WhatsAppAccountsService } from "./whatsapp-accounts.service.js";

/** Configuração técnica: somente SUPERADMIN. */
@Controller("admin/companies/:companyId/whatsapp")
@UseGuards(SuperadminGuard, CompanyAccessGuard)
export class WhatsAppAdminController {
  constructor(private readonly accounts: WhatsAppAccountsService) {}

  @Get()
  get(@CurrentCompany() company: Company): Promise<WhatsAppAdminResponse> {
    return this.accounts.getAdmin(company);
  }

  @Put()
  upsert(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @Body({ schema: updateWhatsAppAccountSchema }) body: UpdateWhatsAppAccountData,
  ): Promise<WhatsAppAdminResponse> {
    return this.accounts.upsert(company, body, actor);
  }

  @Post("actions")
  @HttpCode(HttpStatus.OK)
  action(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @Body({ schema: whatsappAccountActionSchema }) body: { action: WhatsAppAccountAction },
  ): Promise<WhatsAppAdminResponse> {
    return this.accounts.runAction(company, body.action, actor);
  }
}

/** O que a empresa vê da própria conexão: estado e número, nada técnico. */
@Controller("companies/:companyId/whatsapp")
@UseGuards(CompanyAccessGuard)
export class WhatsAppCompanyController {
  constructor(private readonly accounts: WhatsAppAccountsService) {}

  @Get()
  status(@CurrentCompany() company: Company): Promise<WhatsAppCompanyStatus> {
    return this.accounts.companyStatus(company);
  }
}
