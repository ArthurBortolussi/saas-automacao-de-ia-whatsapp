import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentAvailability, Company, CompanyMember, User } from "@arthur-ai/database";
import {
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  type CreateTeamMemberData,
  type TeamMemberItem,
  type TeamResponse,
  type UpdateTeamMemberInput,
  type UpdateTeamSettingsInput,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { CompaniesService } from "../companies/companies.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { canEditSettings, initialSettingsPermissions, requireSettingsPermission } from "../settings/settings-access.js";
import { DistributionService, isTeamManager } from "./distribution.service.js";
import { lockCompanyTeam } from "./team-lock.js";

/**
 * Equipe da empresa. A administração cotidiana é do OWNER/ADMIN da própria empresa; o SUPERADMIN consulta
 * (supervisão) e mantém as rotas técnicas da Fase 1. Toda regra é conferida aqui, no backend.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly distribution: DistributionService,
  ) {}

  async list(company: Company, user: User, membership: CompanyMember | null): Promise<TeamResponse> {
    const [members, loads, waiting, settings] = await Promise.all([
      this.prisma.companyMember.findMany({
        where: { companyId: company.id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true, status: true, mustChangePassword: true } } },
      }),
      this.prisma.conversation.groupBy({
        by: ["assignedUserId"],
        where: { companyId: company.id, status: "ASSIGNED" },
        _count: { _all: true },
      }),
      this.prisma.conversation.count({ where: { companyId: company.id, status: "QUEUED" } }),
      this.prisma.teamSettings.findUnique({ where: { companyId: company.id } }),
    ]);
    const loadOf = new Map(loads.map((row) => [row.assignedUserId, row._count._all]));
    // E-mail e senha provisória pendente: só para quem administra (ou supervisiona).
    const privileged = isTeamManager(membership) || user.globalRole === "SUPERADMIN";
    const items: TeamMemberItem[] = members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: privileged ? member.user.email : null,
      role: member.role,
      active: member.user.status === "ACTIVE",
      mustChangePassword: privileged ? member.user.mustChangePassword : null,
      availability: member.availability,
      availabilityChangedAt: member.availabilityChangedAt?.toISOString() ?? null,
      maxConcurrent: member.maxConcurrent,
      canAttend: member.canAttend,
      activeConversations: loadOf.get(member.userId) ?? 0,
      isMe: member.userId === user.id,
    }));
    return {
      members: items,
      me: items.find((item) => item.isMe) ?? null,
      canManage: isTeamManager(membership),
      queue: { waiting },
      settings: { inactivityTimeoutMinutes: settings?.inactivityTimeoutMinutes ?? DEFAULT_INACTIVITY_TIMEOUT_MINUTES },
      canEditSettings: Boolean(membership) && canEditSettings(user, membership, "SERVICE"),
    };
  }

  private requireManager(membership: CompanyMember | null): CompanyMember {
    if (!membership) throw new ForbiddenException("O Superadmin acompanha a equipe; o cadastro é feito pelo responsável da empresa.");
    if (!isTeamManager(membership)) throw new ForbiddenException("Sua função não permite esta ação.");
    return membership;
  }

  /** Reaproveita o cadastro da Fase 1: senha provisória e troca obrigatória no primeiro acesso. */
  async createMember(company: Company, data: CreateTeamMemberData, actor: User, membership: CompanyMember | null): Promise<TeamResponse> {
    const manager = this.requireManager(membership);
    if (manager.role !== "OWNER" && data.role === "OWNER") throw new ForbiddenException("Apenas o proprietário pode cadastrar outro proprietário.");
    await this.companies.createMember(
      company,
      { name: data.name, email: data.email, password: data.password, role: data.role },
      actor,
      { maxConcurrent: data.maxConcurrent, canAttend: data.canAttend, settingsPermissions: initialSettingsPermissions(data.role, manager) },
    );
    return this.list(company, actor, membership);
  }

  async updateMember(
    company: Company,
    targetUserId: string,
    data: UpdateTeamMemberInput,
    actor: User,
    membership: CompanyMember | null,
  ): Promise<TeamResponse> {
    const manager = this.requireManager(membership);
    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const target = await tx.companyMember.findUnique({
        where: { companyId_userId: { companyId: company.id, userId: targetUserId } },
        include: { user: { select: { status: true } } },
      });
      if (!target) throw new NotFoundException("Funcionário não encontrado nesta empresa.");
      if (target.userId === actor.id && (data.role !== undefined || data.active !== undefined)) {
        throw new ConflictException("Você não pode alterar o próprio perfil nem desativar a própria conta.");
      }
      if (manager.role !== "OWNER" && (target.role === "OWNER" || data.role === "OWNER")) {
        throw new ForbiddenException("Apenas o proprietário pode alterar proprietários.");
      }
      const losesOwner = target.role === "OWNER" && ((data.role !== undefined && data.role !== "OWNER") || data.active === false);
      if (losesOwner) {
        const owners = await tx.companyMember.count({
          where: { companyId: company.id, role: "OWNER", userId: { not: target.userId }, user: { status: "ACTIVE" } },
        });
        if (owners === 0) throw new ConflictException("A empresa precisa de pelo menos um proprietário ativo.");
      }
      const record = (action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS], metadata: Record<string, string | number | boolean>) =>
        this.audit.record(
          { action, actorUserId: actor.id, entityType: "CompanyMember", entityId: target.id, companyId: company.id, metadata: { userId: target.userId, ...metadata } },
          tx,
        );

      if (data.role !== undefined && data.role !== target.role) {
        await tx.companyMember.update({ where: { id: target.id }, data: { role: data.role } });
        await record(AUDIT_ACTIONS.MEMBER_ROLE_CHANGED, { from: target.role, to: data.role });
      }
      if (data.maxConcurrent !== undefined && data.maxConcurrent !== target.maxConcurrent) {
        // Baixar o limite não tira conversas de ninguém: só impede novas até a carga cair.
        await tx.companyMember.update({ where: { id: target.id }, data: { maxConcurrent: data.maxConcurrent } });
        await record(AUDIT_ACTIONS.MEMBER_LIMIT_CHANGED, { from: target.maxConcurrent, to: data.maxConcurrent });
      }
      if (data.canAttend !== undefined && data.canAttend !== target.canAttend) {
        await tx.companyMember.update({ where: { id: target.id }, data: { canAttend: data.canAttend } });
        await record(AUDIT_ACTIONS.MEMBER_CAN_ATTEND_CHANGED, { canAttend: data.canAttend });
      }
      const active = target.user.status === "ACTIVE";
      if (data.active !== undefined && data.active !== active) {
        await tx.user.update({ where: { id: target.userId }, data: { status: data.active ? "ACTIVE" : "INACTIVE" } });
        if (!data.active) {
          // Desativado não entra mais (sessões encerradas) e não fica com clientes esperando por ele.
          await tx.session.deleteMany({ where: { userId: target.userId } });
          await tx.companyMember.update({ where: { id: target.id }, data: { availability: "AWAY", availabilityChangedAt: new Date() } });
          const requeued = await this.distribution.requeueMemberConversations(tx, company.id, target.userId, actor.id);
          await record(AUDIT_ACTIONS.MEMBER_DEACTIVATED, { requeuedConversations: requeued });
        } else {
          await record(AUDIT_ACTIONS.MEMBER_ACTIVATED, {});
        }
      }
    });
    await this.distribution.distribute(company.id);
    return this.list(company, actor, membership);
  }

  /** Cada funcionário escolhe a própria disponibilidade. Não mexe nas conversas que ele já tem. */
  async setAvailability(company: Company, availability: AgentAvailability, actor: User, membership: CompanyMember | null): Promise<TeamResponse> {
    if (!membership) throw new ForbiddenException("Só funcionários da empresa têm disponibilidade.");
    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const current = await tx.companyMember.findUniqueOrThrow({ where: { id: membership.id }, select: { availability: true } });
      if (current.availability === availability) return;
      await tx.companyMember.update({ where: { id: membership.id }, data: { availability, availabilityChangedAt: new Date() } });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.MEMBER_AVAILABILITY_CHANGED,
          actorUserId: actor.id,
          entityType: "CompanyMember",
          entityId: membership.id,
          companyId: company.id,
          metadata: { from: current.availability, to: availability },
        },
        tx,
      );
    });
    if (availability === "AVAILABLE") await this.distribution.distribute(company.id);
    return this.list(company, actor, membership);
  }

  /** Prazo de inatividade da equipe. Fase 7: grupo "Atendimento e fila" (o mesmo dado da aba Atendimento). */
  async updateSettings(company: Company, data: UpdateTeamSettingsInput, actor: User, membership: CompanyMember | null): Promise<TeamResponse> {
    if (!membership) throw new ForbiddenException("O Superadmin acompanha a equipe; o cadastro é feito pelo responsável da empresa.");
    requireSettingsPermission(actor, membership, "SERVICE");
    await this.prisma.$transaction(async (tx) => {
      await tx.teamSettings.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, inactivityTimeoutMinutes: data.inactivityTimeoutMinutes },
        update: { inactivityTimeoutMinutes: data.inactivityTimeoutMinutes },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.TEAM_SETTINGS_UPDATED,
          actorUserId: actor.id,
          entityType: "TeamSettings",
          entityId: company.id,
          companyId: company.id,
          metadata: { inactivityTimeoutMinutes: data.inactivityTimeoutMinutes },
        },
        tx,
      );
    });
    return this.list(company, actor, membership);
  }
}
