import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import {
  createTeamMemberSchema,
  updateAvailabilitySchema,
  updateTeamMemberSchema,
  updateTeamSettingsSchema,
  uuidSchema,
  type CreateTeamMemberData,
  type TeamResponse,
  type UpdateAvailabilityInput,
  type UpdateTeamMemberInput,
  type UpdateTeamSettingsInput,
} from "@arthur-ai/shared";
import { CompanyRoles } from "../common/decorators/company-roles.decorator.js";
import { CurrentCompany, CurrentMembership, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { TeamService } from "./team.service.js";

/**
 * Equipe. Leitura: qualquer membro (e o SUPERADMIN, em supervisão). Escrita: OWNER/ADMIN da empresa; o serviço
 * também recusa o SUPERADMIN, porque a administração cotidiana é do responsável da empresa.
 */
@Controller("companies/:companyId/team")
@UseGuards(CompanyAccessGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentCompany() company: Company, @CurrentUser() user: User, @CurrentMembership() membership: CompanyMember | null): Promise<TeamResponse> {
    return this.team.list(company, user, membership);
  }

  @Post("members")
  @CompanyRoles("OWNER", "ADMIN")
  create(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: createTeamMemberSchema }) body: CreateTeamMemberData,
  ): Promise<TeamResponse> {
    return this.team.createMember(company, body, user, membership);
  }

  @Patch("members/:userId")
  @CompanyRoles("OWNER", "ADMIN")
  update(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Param("userId", { schema: uuidSchema }) userId: string,
    @Body({ schema: updateTeamMemberSchema }) body: UpdateTeamMemberInput,
  ): Promise<TeamResponse> {
    return this.team.updateMember(company, userId, body, user, membership);
  }

  /** A própria disponibilidade (qualquer funcionário). */
  @Patch("me/availability")
  availability(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateAvailabilitySchema }) body: UpdateAvailabilityInput,
  ): Promise<TeamResponse> {
    return this.team.setAvailability(company, body.availability, user, membership);
  }

  /** Fase 7: permissão individual "Atendimento e fila" (conferida no serviço). */
  @Patch("settings")
  settings(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @CurrentMembership() membership: CompanyMember | null,
    @Body({ schema: updateTeamSettingsSchema }) body: UpdateTeamSettingsInput,
  ): Promise<TeamResponse> {
    return this.team.updateSettings(company, body, user, membership);
  }
}
