import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import {
  aiPauseSchema,
  aiUsageQuerySchema,
  createKnowledgeEntrySchema,
  listKnowledgeQuerySchema,
  updateAdminAiSettingsSchema,
  updateCompanyAiSettingsSchema,
  updateKnowledgeEntrySchema,
  uuidSchema,
  type AiPauseInput,
  type AiStatusResponse,
  type AiUsageQuery,
  type AiUsageSummary,
  type CreateKnowledgeEntryData,
  type KnowledgeEntryItem,
  type KnowledgeListResponse,
  type ListKnowledgeQuery,
  type UpdateAiSettingsData,
  type UpdateKnowledgeEntryData,
} from "@arthur-ai/shared";
import { CompanyRoles } from "../common/decorators/company-roles.decorator.js";
import { CurrentCompany, CurrentMembership, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { SuperadminGuard } from "../common/guards/superadmin.guard.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AiUsageService } from "./ai-usage.service.js";
import { KnowledgeService } from "./knowledge.service.js";

/**
 * Rotas da empresa. Leitura: qualquer membro. Edição das configurações: permissão individual por grupo (Fase 7,
 * conferida no serviço); base de conhecimento: OWNER/ADMIN (o SUPERADMIN passa pelo guard).
 * A permissão é do backend: esconder botões no frontend é só conveniência.
 */
@Controller("companies/:companyId")
@UseGuards(CompanyAccessGuard)
export class AiCompanyController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Get("ai")
  status(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
  ): Promise<AiStatusResponse> {
    return this.settings.status(company, user, membership);
  }

  /** Atendimento (nome, tom, orientações, horário, mensagem de transferência). Ligar a IA é só do SUPERADMIN. */
  @Patch("ai/settings")
  updateSettings(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateCompanyAiSettingsSchema }) body: UpdateAiSettingsData,
  ): Promise<AiStatusResponse> {
    return this.settings.update(company, body, user, membership, "company");
  }

  /** Fase 7: pausar (com confirmação) ou retomar a IA. Permissão "Configurações da IA". */
  @Post("ai/pause")
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: aiPauseSchema }) body: AiPauseInput,
  ): Promise<AiStatusResponse> {
    return this.settings.setPaused(company, body.action, user, membership);
  }

  @Get("knowledge-base")
  list(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Query({ schema: listKnowledgeQuerySchema }) query: ListKnowledgeQuery,
  ): Promise<KnowledgeListResponse> {
    return this.knowledge.list(company, query, user, membership);
  }

  @Get("knowledge-base/:entryId")
  get(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("entryId", { schema: uuidSchema }) entryId: string,
  ): Promise<KnowledgeEntryItem> {
    return this.knowledge.get(company, entryId, user, membership);
  }

  @Post("knowledge-base")
  @CompanyRoles("OWNER", "ADMIN")
  create(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Body({ schema: createKnowledgeEntrySchema }) body: CreateKnowledgeEntryData,
  ): Promise<KnowledgeEntryItem> {
    return this.knowledge.create(company, body, user);
  }

  @Patch("knowledge-base/:entryId")
  @CompanyRoles("OWNER", "ADMIN")
  update(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Param("entryId", { schema: uuidSchema }) entryId: string,
    @Body({ schema: updateKnowledgeEntrySchema }) body: UpdateKnowledgeEntryData,
  ): Promise<KnowledgeEntryItem> {
    return this.knowledge.update(company, entryId, body, user);
  }

  @Delete("knowledge-base/:entryId")
  @CompanyRoles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Param("entryId", { schema: uuidSchema }) entryId: string,
  ): Promise<void> {
    return this.knowledge.remove(company, entryId, user);
  }
}

/** Configuração técnica e consumo: somente SUPERADMIN. */
@Controller("admin/companies/:companyId/ai")
@UseGuards(SuperadminGuard, CompanyAccessGuard)
export class AiAdminController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
  ) {}

  @Patch("settings")
  updateSettings(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateAdminAiSettingsSchema }) body: UpdateAiSettingsData,
  ): Promise<AiStatusResponse> {
    return this.settings.update(company, body, user, membership, "admin");
  }

  @Get("usage")
  usageSummary(@CurrentCompany() company: Company, @Query({ schema: aiUsageQuerySchema }) query: AiUsageQuery): Promise<AiUsageSummary> {
    return this.usage.summary(company, query.period);
  }
}
