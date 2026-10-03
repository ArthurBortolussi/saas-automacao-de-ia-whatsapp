import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Company, CompanyMember, Prisma, ScheduleException, User } from "@arthur-ai/database";
import {
  brazilianNationalHolidays,
  isQueueOverdue,
  localDateTime,
  SETTINGS_PERMISSIONS,
  type AutoMessageKind,
  type CalendarResponse,
  type CompanyAlertsResponse,
  type CompanySettingsResponse,
  type ScheduleExceptionData,
  type ScheduleExceptionItem,
  type UpdateAutoMessagesInput,
  type UpdateCompanyProfileInput,
  type UpdateMemberPermissionsInput,
  type UpdateSchedulesInput,
  type UpdateServiceSettingsInput,
  type WeeklySchedule,
} from "@arthur-ai/shared";
import { AiBudgetService } from "../ai/ai-budget.service.js";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { definedOnly } from "../common/defined.js";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { toCompanyDetail } from "../companies/company.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DistributionService } from "../team/distribution.service.js";
import { lockCompanyTeam } from "../team/team-lock.js";
import { dateKey, DEFAULT_AUTO_MESSAGES, isScheduleOpen, loadCompanyRuntime } from "./runtime.js";
import { canEditSettings, isCompanyOwner, requireOwner, requireSettingsPermission, settingsPermissionsOf } from "./settings-access.js";

const EXCEPTION_NOT_FOUND = "Data especial não encontrada.";

function exceptionItem(row: ScheduleException): ScheduleExceptionItem {
  return {
    id: row.id,
    date: dateKey(row.date),
    label: row.label,
    business: { mode: row.businessMode, start: row.businessStart, end: row.businessEnd },
    ai: { mode: row.aiMode, start: row.aiStart, end: row.aiEnd },
    team: { mode: row.teamMode, start: row.teamStart, end: row.teamEnd },
    updatedAt: row.updatedAt.toISOString(),
  };
}

function exceptionData(data: ScheduleExceptionData) {
  return {
    date: new Date(`${data.date}T00:00:00Z`),
    label: data.label,
    businessMode: data.business.mode,
    businessStart: data.business.start,
    businessEnd: data.business.end,
    aiMode: data.ai.mode,
    aiStart: data.ai.start,
    aiEnd: data.ai.end,
    teamMode: data.team.mode,
    teamStart: data.team.start,
    teamEnd: data.team.end,
  };
}

const MESSAGE_COLUMNS: Record<AutoMessageKind, { enabled: keyof UpdateAutoMessagesInput; message: keyof UpdateAutoMessagesInput }> = {
  welcome: { enabled: "welcomeEnabled", message: "welcomeMessage" },
  queueNotice: { enabled: "queueNoticeEnabled", message: "queueNoticeMessage" },
  afterHours: { enabled: "afterHoursEnabled", message: "afterHoursMessage" },
  closing: { enabled: "closingEnabled", message: "closingMessage" },
};

/**
 * FASE 7: configurações da empresa organizadas por grupo. Toda escrita confere o grupo no backend (permissão
 * individual relida a cada requisição) e grava a auditoria na mesma transação. As alterações valem para os
 * PRÓXIMOS eventos: nada é reenviado nem recalculado para atendimentos e mensagens que já aconteceram.
 */
@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly distribution: DistributionService,
    private readonly budget: AiBudgetService,
  ) {}

  async get(company: Company, user: User, membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    const [runtime, logo, ai, members] = await Promise.all([
      loadCompanyRuntime(this.prisma, company.id),
      this.prisma.companyLogo.findUnique({ where: { companyId: company.id }, select: { updatedAt: true } }),
      this.prisma.aiSettings.findUnique({ where: { companyId: company.id }, select: { enabled: true, pausedAt: true } }),
      isCompanyOwner(membership)
        ? this.prisma.companyMember.findMany({
            where: { companyId: company.id },
            orderBy: { createdAt: "asc" },
            include: { user: { select: { name: true, status: true } } },
          })
        : Promise.resolve(null),
    ]);
    const message = (kind: AutoMessageKind) => {
      const config = runtime.messages[kind];
      const custom = config.text === DEFAULT_AUTO_MESSAGES[kind] ? null : config.text;
      return { enabled: config.enabled, message: custom, effective: config.text, defaultMessage: DEFAULT_AUTO_MESSAGES[kind] };
    };
    return {
      company: toCompanyDetail(company, logo?.updatedAt ?? null),
      schedules: {
        timezone: runtime.timezone,
        business: plain(runtime.schedules.business),
        ai: plain(runtime.schedules.ai),
        team: plain(runtime.schedules.team),
      },
      openNow: {
        business: isScheduleOpen(runtime, "business"),
        ai: isScheduleOpen(runtime, "ai"),
        team: isScheduleOpen(runtime, "team"),
      },
      messages: {
        welcome: message("welcome"),
        queueNotice: message("queueNotice"),
        afterHours: message("afterHours"),
        closing: message("closing"),
      },
      service: { maxQueueWaitMinutes: runtime.maxQueueWaitMinutes, inactivityTimeoutMinutes: runtime.inactivityTimeoutMinutes },
      ai: { enabled: ai?.enabled ?? false, paused: Boolean(ai?.pausedAt), pausedAt: ai?.pausedAt?.toISOString() ?? null },
      permissions: settingsPermissionsOf(user, membership),
      members:
        members?.map((member) => ({
          userId: member.userId,
          name: member.user.name,
          role: member.role,
          active: member.user.status === "ACTIVE",
          permissions: member.role === "OWNER" ? [...SETTINGS_PERMISSIONS] : member.settingsPermissions,
          isMe: member.userId === user.id,
        })) ?? null,
    };
  }

  /** Aba Empresa: nome comercial e fuso. Somente o proprietário (nem o SUPERADMIN, nem administradores). */
  async updateProfile(company: Company, data: UpdateCompanyProfileInput, actor: User, membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    requireOwner(membership, "alterar o nome comercial e o fuso horário");
    const changes: { name?: string; timezone?: string } = {};
    if (data.name !== undefined && data.name !== company.name) changes.name = data.name;
    if (data.timezone !== undefined && data.timezone !== company.timezone) changes.timezone = data.timezone;
    let updated = company;
    if (Object.keys(changes).length > 0) {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.company.update({ where: { id: company.id }, data: changes });
        // O fuso legado da IA acompanha (uma única fonte: Company.timezone).
        if (changes.timezone) await tx.aiSettings.updateMany({ where: { companyId: company.id }, data: { timezone: changes.timezone } });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.COMPANY_PROFILE_UPDATED,
            actorUserId: actor.id,
            entityType: "Company",
            entityId: company.id,
            companyId: company.id,
            metadata: {
              fields: Object.keys(changes),
              ...(changes.name ? { from: company.name, to: changes.name } : {}),
              ...(changes.timezone ? { timezoneFrom: company.timezone, timezoneTo: changes.timezone } : {}),
            },
          },
          tx,
        );
        return row;
      });
    }
    return this.get(updated, actor, membership);
  }

  /**
   * Aba Horários: as três agendas são independentes. O horário da IA continua em AiSettings (a mesma configuração da
   * Fase 4, sem segunda fonte); o geral fica em CompanySettings e o da equipe em TeamSettings.
   */
  async updateSchedules(company: Company, data: UpdateSchedulesInput, actor: User, membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    requireSettingsPermission(actor, membership, "SCHEDULE");
    await this.prisma.$transaction(async (tx) => {
      if (data.business) {
        const values = { businessAlwaysOpen: data.business.alwaysOn, businessDays: data.business.days, businessStart: data.business.start, businessEnd: data.business.end };
        await tx.companySettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...values }, update: values });
      }
      if (data.team) {
        const values = { teamAlwaysOn: data.team.alwaysOn, teamDays: data.team.days, teamStart: data.team.start, teamEnd: data.team.end };
        // Sob a trava da equipe: uma distribuição em andamento termina antes (ou já enxerga o novo expediente).
        await lockCompanyTeam(tx, company.id);
        await tx.teamSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...values }, update: values });
      }
      if (data.ai) {
        const values = { alwaysOn: data.ai.alwaysOn, scheduleDays: data.ai.days, scheduleStart: data.ai.start, scheduleEnd: data.ai.end };
        await tx.aiSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, timezone: company.timezone, ...values }, update: values });
      }
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.SCHEDULES_UPDATED,
          actorUserId: actor.id,
          entityType: "CompanySettings",
          entityId: company.id,
          companyId: company.id,
          metadata: scheduleAudit(data),
        },
        tx,
      );
    });
    // O expediente da equipe pode ter começado agora: a fila é verificada já (o worker também verifica a cada ciclo).
    if (data.team) await this.distribution.distribute(company.id);
    return this.get(company, actor, membership);
  }

  /** Calendário: feriados nacionais (referência) e datas especiais da empresa no ano. */
  async calendar(company: Company, year: number | undefined, user: User, membership: CompanyMember | null): Promise<CalendarResponse> {
    const resolvedYear = year ?? Number(localDateTime(new Date(), company.timezone).date.slice(0, 4));
    const rows = await this.prisma.scheduleException.findMany({
      where: { companyId: company.id, date: { gte: new Date(`${resolvedYear}-01-01T00:00:00Z`), lte: new Date(`${resolvedYear}-12-31T00:00:00Z`) } },
      orderBy: { date: "asc" },
    });
    return {
      year: resolvedYear,
      timezone: company.timezone,
      holidays: brazilianNationalHolidays(resolvedYear),
      exceptions: rows.map(exceptionItem),
      canEdit: canEditSettings(user, membership, "SCHEDULE"),
    };
  }

  async createException(company: Company, data: ScheduleExceptionData, actor: User, membership: CompanyMember | null): Promise<ScheduleExceptionItem> {
    requireSettingsPermission(actor, membership, "SCHEDULE");
    let item: ScheduleExceptionItem;
    try {
      item = await this.prisma.$transaction(async (tx) => {
        const row = await tx.scheduleException.create({ data: { companyId: company.id, ...exceptionData(data) } });
        await this.recordException(tx, AUDIT_ACTIONS.SCHEDULE_EXCEPTION_CREATED, row, actor);
        return exceptionItem(row);
      });
    } catch (error) {
      if (uniqueViolationIndex(error) === "ScheduleException_companyId_date_key") {
        throw new ConflictException("Já existe uma data especial cadastrada neste dia. Edite a existente.");
      }
      throw error;
    }
    // Uma exceção de hoje pode abrir o expediente da equipe agora.
    await this.distribution.distribute(company.id);
    return item;
  }

  async updateException(
    company: Company,
    exceptionId: string,
    data: ScheduleExceptionData,
    actor: User,
    membership: CompanyMember | null,
  ): Promise<ScheduleExceptionItem> {
    requireSettingsPermission(actor, membership, "SCHEDULE");
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.scheduleException.findUnique({ where: { id_companyId: { id: exceptionId, companyId: company.id } } });
        if (!existing) throw new NotFoundException(EXCEPTION_NOT_FOUND);
        const row = await tx.scheduleException.update({ where: { id: existing.id }, data: exceptionData(data) });
        await this.recordException(tx, AUDIT_ACTIONS.SCHEDULE_EXCEPTION_UPDATED, row, actor);
        return exceptionItem(row);
      });
      await this.distribution.distribute(company.id);
      return item;
    } catch (error) {
      if (uniqueViolationIndex(error) === "ScheduleException_companyId_date_key") {
        throw new ConflictException("Já existe uma data especial cadastrada neste dia.");
      }
      throw error;
    }
  }

  async deleteException(company: Company, exceptionId: string, actor: User, membership: CompanyMember | null): Promise<void> {
    requireSettingsPermission(actor, membership, "SCHEDULE");
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scheduleException.findUnique({ where: { id_companyId: { id: exceptionId, companyId: company.id } } });
      if (!existing) throw new NotFoundException(EXCEPTION_NOT_FOUND);
      await tx.scheduleException.delete({ where: { id: existing.id } });
      await this.recordException(tx, AUDIT_ACTIONS.SCHEDULE_EXCEPTION_DELETED, existing, actor);
    });
    await this.distribution.distribute(company.id);
  }

  private recordException(
    tx: Prisma.TransactionClient,
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    row: ScheduleException,
    actor: User,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        actorUserId: actor.id,
        entityType: "ScheduleException",
        entityId: row.id,
        companyId: row.companyId,
        metadata: {
          date: dateKey(row.date),
          label: row.label,
          business: row.businessMode,
          ai: row.aiMode,
          team: row.teamMode,
        },
      },
      tx,
    );
  }

  /** Aba Mensagens: textos e liga/desliga. Mudanças nunca reenviam mensagens a quem já recebeu. */
  async updateMessages(company: Company, data: UpdateAutoMessagesInput, actor: User, membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    requireSettingsPermission(actor, membership, "MESSAGES");
    const values = definedOnly(data);
    await this.prisma.$transaction(async (tx) => {
      await tx.companySettings.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ...values },
        update: values,
      });
      const changed = (Object.keys(MESSAGE_COLUMNS) as AutoMessageKind[]).filter(
        (kind) => data[MESSAGE_COLUMNS[kind].enabled] !== undefined || data[MESSAGE_COLUMNS[kind].message] !== undefined,
      );
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.AUTO_MESSAGES_UPDATED,
          actorUserId: actor.id,
          entityType: "CompanySettings",
          entityId: company.id,
          companyId: company.id,
          // Textos operacionais da própria empresa (sem dados de clientes nem segredos).
          metadata: { messages: changed, fields: Object.keys(values), values },
        },
        tx,
      );
    });
    return this.get(company, actor, membership);
  }

  /** Aba Atendimento: limite de espera (alerta) e prazo de inatividade da equipe (o mesmo dado da aba Equipe). */
  async updateService(company: Company, data: UpdateServiceSettingsInput, actor: User, membership: CompanyMember | null): Promise<CompanySettingsResponse> {
    if (!membership) throw new ForbiddenException("O Superadmin acompanha a operação; estas configurações são da empresa.");
    requireSettingsPermission(actor, membership, "SERVICE");
    const values = definedOnly(data);
    await this.prisma.$transaction(async (tx) => {
      await tx.teamSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...values }, update: values });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.SERVICE_SETTINGS_UPDATED,
          actorUserId: actor.id,
          entityType: "TeamSettings",
          entityId: company.id,
          companyId: company.id,
          metadata: values,
        },
        tx,
      );
    });
    return this.get(company, actor, membership);
  }

  /**
   * Aba Permissões: somente o proprietário. Ninguém administra as próprias permissões, proprietários não precisam
   * de concessão (têm tudo) e o alvo precisa ser membro DESTA empresa (outra empresa ou inexistente → 404).
   */
  async updateMemberPermissions(
    company: Company,
    targetUserId: string,
    data: UpdateMemberPermissionsInput,
    actor: User,
    membership: CompanyMember | null,
  ): Promise<CompanySettingsResponse> {
    requireOwner(membership, "conceder ou revogar permissões");
    if (targetUserId === actor.id) throw new ForbiddenException("Você não pode alterar as próprias permissões.");
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId: company.id, userId: targetUserId } } });
      if (!target) throw new NotFoundException("Membro não encontrado nesta empresa.");
      if (target.role === "OWNER") throw new ConflictException("Proprietários já têm todas as permissões.");
      const before = [...target.settingsPermissions].sort();
      const after = data.permissions;
      if (before.join() === after.join()) return;
      await tx.companyMember.update({ where: { id: target.id }, data: { settingsPermissions: after } });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.SETTINGS_PERMISSIONS_CHANGED,
          actorUserId: actor.id,
          entityType: "CompanyMember",
          entityId: target.id,
          companyId: company.id,
          metadata: {
            userId: target.userId,
            granted: after.filter((permission) => !before.includes(permission)),
            revoked: before.filter((permission) => !after.includes(permission)),
          },
        },
        tx,
      );
    });
    return this.get(company, actor, membership);
  }

  /** Alertas do painel (OWNER/ADMIN e SUPERADMIN): espera excessiva e nível de uso da IA, sem valores. */
  async alerts(company: Company): Promise<CompanyAlertsResponse> {
    const [runtime, queued, ai] = await Promise.all([
      loadCompanyRuntime(this.prisma, company.id),
      this.prisma.conversation.findMany({ where: { companyId: company.id, status: "QUEUED" }, select: { queuedAt: true } }),
      this.prisma.aiSettings.findUnique({ where: { companyId: company.id }, select: { pausedAt: true } }),
    ]);
    const now = new Date();
    return {
      queue: {
        overdue: queued.filter((row) => isQueueOverdue(row.queuedAt, runtime.maxQueueWaitMinutes, now)).length,
        waiting: queued.length,
        maxQueueWaitMinutes: runtime.maxQueueWaitMinutes,
      },
      aiUsage: await this.budget.level(company),
      aiPaused: Boolean(ai?.pausedAt),
    };
  }
}

function plain(schedule: WeeklySchedule): WeeklySchedule {
  return { alwaysOn: schedule.alwaysOn, days: [...schedule.days], start: schedule.start, end: schedule.end };
}

function scheduleAudit(data: UpdateSchedulesInput): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonObject> = {};
  for (const kind of ["business", "ai", "team"] as const) {
    const schedule = data[kind];
    if (schedule) out[kind] = { alwaysOn: schedule.alwaysOn, days: schedule.days, start: schedule.start, end: schedule.end };
  }
  return out;
}
