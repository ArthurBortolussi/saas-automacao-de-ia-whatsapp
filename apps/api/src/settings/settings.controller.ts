import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import {
  calendarQuerySchema,
  companySuspensionSchema,
  scheduleExceptionSchema,
  updateAutoMessagesSchema,
  updateCompanyProfileSchema,
  updateMemberPermissionsSchema,
  updatePlatformSettingsSchema,
  updateSchedulesSchema,
  updateServiceSettingsSchema,
  uuidSchema,
  type AdminAlertsResponse,
  type AdminPlatformSettingsResponse,
  type CalendarQuery,
  type CalendarResponse,
  type CompanyAlertsResponse,
  type CompanyDetail,
  type CompanySettingsResponse,
  type CompanySuspensionInput,
  type ScheduleExceptionData,
  type ScheduleExceptionItem,
  type SupportContacts,
  type UpdateAutoMessagesInput,
  type UpdateCompanyProfileInput,
  type UpdateMemberPermissionsInput,
  type UpdatePlatformSettingsInput,
  type UpdateSchedulesInput,
  type UpdateServiceSettingsInput,
} from "@arthur-ai/shared";
import type { Request, Response } from "express";
import { AllowWhilePasswordChange } from "../common/decorators/allow-password-change.decorator.js";
import { CompanyRoles } from "../common/decorators/company-roles.decorator.js";
import { CurrentCompany, CurrentMembership, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { SuperadminGuard } from "../common/guards/superadmin.guard.js";
import { CompanySettingsService } from "./company-settings.service.js";
import { LogoService } from "./logo.service.js";
import { PlatformService } from "./platform.service.js";
import { SuspensionService } from "./suspension.service.js";

/**
 * FASE 7: configurações da empresa. Leitura: qualquer membro (e o SUPERADMIN). Escrita: conferida por grupo no
 * serviço (permissão individual), com nome/logotipo/fuso/permissões exclusivos do proprietário.
 */
@Controller("companies/:companyId")
@UseGuards(CompanyAccessGuard)
export class CompanySettingsController {
  constructor(
    private readonly settings: CompanySettingsService,
    private readonly logos: LogoService,
  ) {}

  @Get("settings")
  get(@CurrentCompany() company: Company, @CurrentUser() user: User, @CurrentMembership() membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    return this.settings.get(company, user, membership);
  }

  @Patch("settings/company")
  profile(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateCompanyProfileSchema }) body: UpdateCompanyProfileInput,
  ): Promise<CompanySettingsResponse> {
    return this.settings.updateProfile(company, body, user, membership);
  }

  @Patch("settings/schedules")
  schedules(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateSchedulesSchema }) body: UpdateSchedulesInput,
  ): Promise<CompanySettingsResponse> {
    return this.settings.updateSchedules(company, body, user, membership);
  }

  @Get("settings/calendar")
  calendar(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Query({ schema: calendarQuerySchema }) query: CalendarQuery,
  ): Promise<CalendarResponse> {
    return this.settings.calendar(company, query.year, user, membership);
  }

  @Post("settings/exceptions")
  createException(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: scheduleExceptionSchema }) body: ScheduleExceptionData,
  ): Promise<ScheduleExceptionItem> {
    return this.settings.createException(company, body, user, membership);
  }

  @Put("settings/exceptions/:exceptionId")
  updateException(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("exceptionId", { schema: uuidSchema }) exceptionId: string,
    @Body({ schema: scheduleExceptionSchema }) body: ScheduleExceptionData,
  ): Promise<ScheduleExceptionItem> {
    return this.settings.updateException(company, exceptionId, body, user, membership);
  }

  @Delete("settings/exceptions/:exceptionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteException(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("exceptionId", { schema: uuidSchema }) exceptionId: string,
  ): Promise<void> {
    return this.settings.deleteException(company, exceptionId, user, membership);
  }

  @Patch("settings/messages")
  messages(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateAutoMessagesSchema }) body: UpdateAutoMessagesInput,
  ): Promise<CompanySettingsResponse> {
    return this.settings.updateMessages(company, body, user, membership);
  }

  @Patch("settings/service")
  service(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateServiceSettingsSchema }) body: UpdateServiceSettingsInput,
  ): Promise<CompanySettingsResponse> {
    return this.settings.updateService(company, body, user, membership);
  }

  @Put("settings/permissions/:userId")
  permissions(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("userId", { schema: uuidSchema }) userId: string,
    @Body({ schema: updateMemberPermissionsSchema }) body: UpdateMemberPermissionsInput,
  ): Promise<CompanySettingsResponse> {
    return this.settings.updateMemberPermissions(company, userId, body, user, membership);
  }

  /** Alertas do painel (sem valores financeiros). AGENT recebe 403. */
  @Get("alerts")
  @CompanyRoles("OWNER", "ADMIN")
  alerts(@CurrentCompany() company: Company): Promise<CompanyAlertsResponse> {
    return this.settings.alerts(company);
  }

  /** Logotipo: servido só a quem acessa a empresa, com o tipo conferido no upload e sem interpretação pelo navegador. */
  @Get("logo")
  async logo(@CurrentCompany() company: Company, @Req() request: Request, @Res() response: Response): Promise<void> {
    const logo = await this.logos.get(company);
    const etag = `"${logo.sha256}"`;
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("ETag", etag);
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Content-Disposition", "inline");
    if (request.headers["if-none-match"] === etag) {
      response.status(304).end();
      return;
    }
    response.type(logo.contentType).send(Buffer.from(logo.data));
  }

  @Put("logo")
  uploadLogo(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Req() request: Request,
    @Headers("content-type") contentType: string | undefined,
  ): Promise<{ logoVersion: string }> {
    return this.logos.upload(company, request.body, contentType, user, membership);
  }

  @Delete("logo")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeLogo(@CurrentCompany() company: Company, @CurrentUser() user: User, @CurrentMembership() membership: CompanyMember | null): Promise<void> {
    return this.logos.remove(company, user, membership);
  }
}

/** Contatos do suporte: qualquer usuário autenticado (inclusive de empresa suspensa). Nada interno. */
@Controller("support")
export class SupportController {
  constructor(private readonly platform: PlatformService) {}

  @AllowWhilePasswordChange()
  @Get()
  contacts(): Promise<SupportContacts> {
    return this.platform.supportContacts();
  }
}

/** Administração da plataforma (somente SUPERADMIN). */
@Controller("admin")
@UseGuards(SuperadminGuard)
export class AdminPlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly suspension: SuspensionService,
  ) {}

  @Get("alerts")
  alerts(): Promise<AdminAlertsResponse> {
    return this.platform.alerts();
  }

  @Get("platform-settings")
  settings(): Promise<AdminPlatformSettingsResponse> {
    return this.platform.adminView();
  }

  @Patch("platform-settings")
  update(@CurrentUser() user: User, @Body({ schema: updatePlatformSettingsSchema }) body: UpdatePlatformSettingsInput): Promise<AdminPlatformSettingsResponse> {
    return this.platform.update(body, user);
  }

  @Post("companies/:companyId/suspend")
  @UseGuards(CompanyAccessGuard)
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Body({ schema: companySuspensionSchema }) body: CompanySuspensionInput,
  ): Promise<CompanyDetail> {
    return this.suspension.suspend(company, user, body);
  }

  @Post("companies/:companyId/reactivate")
  @UseGuards(CompanyAccessGuard)
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Body({ schema: companySuspensionSchema }) body: CompanySuspensionInput,
  ): Promise<CompanyDetail> {
    return this.suspension.reactivate(company, user, body);
  }
}
