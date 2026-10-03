import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AiTone, Company, CompanyMember, ConversationMode, Prisma, User } from "@arthur-ai/database";
import {
  DEFAULT_AI_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_AI_TIMEZONE,
  DEFAULT_HANDOFF_MESSAGE,
  type AiSettingsView,
  type AiStatusResponse,
  type SettingsPermission,
  type UpdateAiSettingsData,
} from "@arthur-ai/shared";
import { markQueued } from "../analytics/cycle-tracker.js";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { definedOnly } from "../common/defined.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { isScheduleOpen, loadCompanyRuntime } from "../settings/runtime.js";
import { canEditSettings, requireOwner, requireSettingsPermission } from "../settings/settings-access.js";
import { queuedData } from "../team/conversation-state.js";
import { lockCompanyTeam } from "../team/team-lock.js";
import { ConversationEvents } from "../whatsapp/conversation-events.js";
import { AiBudgetService } from "./ai-budget.service.js";
import { knowledgeChars } from "./knowledge.service.js";

export interface ResolvedAiSettings {
  enabled: boolean;
  defaultConversationMode: ConversationMode;
  assistantName: string;
  tone: AiTone;
  instructions: string | null;
  handoffMessage: string | null;
  alwaysOn: boolean;
  /** Legado (Fase 4). Desde a Fase 7 o horário da IA usa Company.timezone; este campo só é mantido em sincronia. */
  timezone: string;
  scheduleDays: number[];
  scheduleStart: string;
  scheduleEnd: string;
  inactivityTimeoutMinutes: number;
  pausedAt: Date | null;
  pausedByUserId: string | null;
  monthlyLimitUsd: Prisma.Decimal | null;
  monthlyLimitUpdatedAt: Date | null;
  updatedAt: Date | null;
}

/** Valores de uma empresa que nunca salvou configurações. A IA nasce DESLIGADA: ligar é decisão explícita. */
export const DEFAULT_AI_SETTINGS: ResolvedAiSettings = {
  enabled: false,
  defaultConversationMode: "AI",
  assistantName: "Assistente",
  tone: "PROFESSIONAL",
  instructions: null,
  handoffMessage: null,
  alwaysOn: true,
  timezone: DEFAULT_AI_TIMEZONE,
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStart: "08:00",
  scheduleEnd: "18:00",
  inactivityTimeoutMinutes: DEFAULT_AI_INACTIVITY_TIMEOUT_MINUTES,
  pausedAt: null,
  pausedByUserId: null,
  monthlyLimitUsd: null,
  monthlyLimitUpdatedAt: null,
  updatedAt: null,
};

type SettingsClient = Pick<PrismaService, "aiSettings"> | Prisma.TransactionClient;

/** Campos do horário da IA (grupo "Horários"); os demais campos da empresa são do grupo "IA". */
const SCHEDULE_FIELDS = new Set(["alwaysOn", "scheduleDays", "scheduleStart", "scheduleEnd"]);
/** Só o SUPERADMIN (rota /admin): o schema da rota da empresa já os recusa. */
const ADMIN_FIELDS = new Set(["enabled", "defaultConversationMode", "monthlyLimitUsd"]);

const LIMIT_REACHED_BLOCKER = "O limite mensal de uso da IA foi atingido. Novos atendimentos são encaminhados para a equipe.";

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly budget: AiBudgetService,
    private readonly events: ConversationEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async resolve(companyId: string, client: SettingsClient = this.prisma): Promise<ResolvedAiSettings> {
    const row = await client.aiSettings.findUnique({ where: { companyId }, omit: { companyId: true, createdAt: true } });
    return row ?? DEFAULT_AI_SETTINGS;
  }

  toView(settings: ResolvedAiSettings, company: Pick<Company, "timezone">): AiSettingsView {
    return {
      enabled: settings.enabled,
      defaultConversationMode: settings.defaultConversationMode,
      assistantName: settings.assistantName,
      tone: settings.tone,
      instructions: settings.instructions,
      handoffMessage: settings.handoffMessage,
      effectiveHandoffMessage: settings.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
      alwaysOn: settings.alwaysOn,
      // Fase 7: fuso único da empresa (horários, exceções, relatórios e mês do limite).
      timezone: company.timezone,
      scheduleDays: settings.scheduleDays,
      scheduleStart: settings.scheduleStart,
      scheduleEnd: settings.scheduleEnd,
      inactivityTimeoutMinutes: settings.inactivityTimeoutMinutes,
      paused: settings.pausedAt !== null,
      pausedAt: settings.pausedAt?.toISOString() ?? null,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
    };
  }

  async status(company: Company, user: User, membership: CompanyMember | null): Promise<AiStatusResponse> {
    const [settings, account, entries, runtime] = await Promise.all([
      this.resolve(company.id),
      this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id }, select: { status: true } }),
      this.prisma.knowledgeEntry.findMany({
        where: { companyId: company.id },
        select: { active: true, title: true, content: true, category: true },
      }),
      loadCompanyRuntime(this.prisma, company.id),
    ]);
    const superadmin = user.globalRole === "SUPERADMIN";
    const manager = superadmin || membership?.role === "OWNER" || membership?.role === "ADMIN";
    const level = await this.budget.level(company);
    const withinSchedule = isScheduleOpen(runtime, "ai");
    const blockers: string[] = [];
    if (!settings.enabled) blockers.push("A IA está desligada para esta empresa.");
    if (settings.pausedAt) blockers.push("A IA está pausada pela empresa. Novas mensagens vão para a equipe.");
    if (!this.env.ai.configured) blockers.push("A IA não está configurada neste servidor (chave da Anthropic ausente).");
    if (!account || account.status === "DISABLED" || account.status === "ERROR") {
      blockers.push("O WhatsApp da empresa não está conectado ou está com erro.");
    }
    if (settings.enabled && !withinSchedule) blockers.push("Fora do horário de atendimento da IA.");
    if (company.status === "PAUSED" || company.status === "INACTIVE") blockers.push("A empresa está pausada ou inativa.");
    if (level === "LIMIT_REACHED") blockers.push(LIMIT_REACHED_BLOCKER);

    const active = entries.filter((entry) => entry.active);
    const canManageKnowledge = superadmin || membership?.role === "OWNER" || membership?.role === "ADMIN";
    return {
      settings: this.toView(settings, company),
      platform: { configured: this.env.ai.configured, simulated: this.env.ai.simulated, model: this.env.ai.model },
      withinSchedule,
      blockers,
      knowledge: {
        total: entries.length,
        active: active.length,
        activeChars: knowledgeChars(active),
        contextLimitChars: this.env.ai.knowledgeMaxChars,
      },
      permissions: { editSettings: canEditSettings(user, membership, "AI"), editAdminSettings: superadmin, editKnowledge: canManageKnowledge },
      // Fase 7: a empresa vê só o nível (sem valores); valores em USD só para o SUPERADMIN.
      usageLevel: manager ? level : null,
      budget: superadmin ? await this.budget.view(company) : null,
    };
  }

  /**
   * Atualização parcial. Rota da empresa: horário da IA exige o grupo "Horários"; fuso, só o proprietário; o restante,
   * o grupo "IA". Rota do SUPERADMIN: tudo, inclusive ligar/desligar, modo padrão e limite mensal.
   * Mudar o modo padrão afeta só conversas NOVAS. Só os campos enviados são gravados (nada sobrescreve uma pausa
   * concorrente, por exemplo).
   */
  async update(
    company: Company,
    data: UpdateAiSettingsData,
    actor: User,
    membership: CompanyMember | null,
    scope: "company" | "admin" = "company",
  ): Promise<AiStatusResponse> {
    const changes = definedOnly(data);
    if (scope === "company") this.assertCompanyCanEdit(Object.keys(changes), actor, membership);

    const current = await this.resolve(company.id);
    const merged = { ...current, ...changes };
    if (!merged.alwaysOn && merged.scheduleStart === merged.scheduleEnd) {
      throw new BadRequestException("O horário de início da IA deve ser diferente do horário de término.");
    }
    const now = new Date();
    const { timezone, monthlyLimitUsd, ...rest } = changes;
    const update: Prisma.AiSettingsUncheckedUpdateInput = { ...rest, ...(timezone ? { timezone } : {}) };
    const limitAudit: Prisma.InputJsonObject[] = [];
    if (monthlyLimitUsd !== undefined) {
      update.monthlyLimitUsd = monthlyLimitUsd === null ? null : monthlyLimitUsd.toFixed(2);
      update.monthlyLimitUpdatedAt = now;
      limitAudit.push({ from: current.monthlyLimitUsd?.toFixed(2) ?? null, to: monthlyLimitUsd === null ? null : monthlyLimitUsd.toFixed(2), origin: "INDIVIDUAL" });
    } else if (changes.enabled === true && !current.enabled && current.monthlyLimitUpdatedAt === null) {
      // Habilitação de uma empresa que nunca teve limite: recebe o padrão da plataforma (cópia; mudanças futuras do
      // padrão não alteram esta empresa).
      const platform = await this.prisma.platformSettings.findUnique({ where: { id: 1 }, select: { defaultAiMonthlyLimitUsd: true } });
      if (platform?.defaultAiMonthlyLimitUsd) {
        update.monthlyLimitUsd = platform.defaultAiMonthlyLimitUsd;
        update.monthlyLimitUpdatedAt = now;
        limitAudit.push({ from: null, to: platform.defaultAiMonthlyLimitUsd.toFixed(2), origin: "PLATFORM_DEFAULT" });
      }
    }
    const create: Prisma.AiSettingsUncheckedCreateInput = {
      companyId: company.id,
      enabled: merged.enabled,
      defaultConversationMode: merged.defaultConversationMode,
      assistantName: merged.assistantName,
      tone: merged.tone,
      instructions: merged.instructions,
      handoffMessage: merged.handoffMessage,
      alwaysOn: merged.alwaysOn,
      timezone: timezone ?? company.timezone,
      scheduleDays: merged.scheduleDays,
      scheduleStart: merged.scheduleStart,
      scheduleEnd: merged.scheduleEnd,
      inactivityTimeoutMinutes: merged.inactivityTimeoutMinutes,
      ...(update.monthlyLimitUsd !== undefined
        ? { monthlyLimitUsd: update.monthlyLimitUsd as Prisma.Decimal | string | null, monthlyLimitUpdatedAt: now }
        : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.aiSettings.upsert({ where: { companyId: company.id }, create, update });
      // Fase 7: o fuso é da EMPRESA (uma única fonte para os três horários, exceções, relatórios e o mês do limite).
      if (timezone) await tx.company.update({ where: { id: company.id }, data: { timezone } });
      // Desligada pelo SUPERADMIN: nada do que estava na fila da IA pode responder depois.
      if (changes.enabled === false && current.enabled) {
        await tx.aiReplyTask.updateMany({
          where: { companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "CANCELED", outcome: "AI_DISABLED", lockedUntil: null, finishedAt: now },
        });
      }
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.AI_SETTINGS_UPDATED,
          actorUserId: actor.id,
          entityType: "AiSettings",
          entityId: company.id,
          companyId: company.id,
          // Só os nomes dos campos e os valores curtos e não sensíveis.
          metadata: {
            fields: Object.keys(changes),
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
            ...(data.defaultConversationMode ? { defaultConversationMode: data.defaultConversationMode } : {}),
            ...(data.inactivityTimeoutMinutes !== undefined ? { inactivityTimeoutMinutes: data.inactivityTimeoutMinutes } : {}),
            ...(timezone ? { timezone } : {}),
          },
        },
        tx,
      );
      for (const metadata of limitAudit) {
        await this.audit.record(
          { action: AUDIT_ACTIONS.AI_LIMIT_UPDATED, actorUserId: actor.id, entityType: "AiSettings", entityId: company.id, companyId: company.id, metadata },
          tx,
        );
      }
    });
    const fresh = timezone ? { ...company, timezone } : company;
    return this.status(fresh, actor, membership);
  }

  private assertCompanyCanEdit(fields: string[], actor: User, membership: CompanyMember | null): void {
    const needed = new Set<SettingsPermission>();
    for (const field of fields) {
      if (ADMIN_FIELDS.has(field)) throw new BadRequestException(`Campo não permitido: ${field}.`);
      if (field === "timezone") {
        requireOwner(membership, "alterar o fuso horário da empresa");
        continue;
      }
      needed.add(SCHEDULE_FIELDS.has(field) ? "SCHEDULE" : "AI");
    }
    for (const permission of needed) requireSettingsPermission(actor, membership, permission);
  }

  /**
   * FASE 7: pausa operacional da IA pela empresa (estado separado da habilitação do SUPERADMIN).
   * Ao pausar, sob a trava da equipe: tarefas pendentes/em geração são canceladas (uma resposta em geração não é
   * enviada: o envio exige a tarefa ainda RUNNING) e as conversas cujo cliente esperava a IA vão para a fila humana.
   * Ao retomar, nada é respondido retroativamente e atendimentos humanos continuam com a equipe.
   */
  async setPaused(company: Company, action: "PAUSE" | "RESUME", actor: User, membership: CompanyMember | null): Promise<AiStatusResponse> {
    requireSettingsPermission(actor, membership, "AI");
    let requeued = 0;
    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const current = await this.resolve(company.id, tx);
      const now = new Date();
      if (action === "RESUME") {
        if (!current.pausedAt) return;
        if (!current.enabled) {
          throw new ConflictException("A IA foi desativada pelo suporte do Arthur AI e não pode ser retomada pela empresa.");
        }
        await tx.aiSettings.update({ where: { companyId: company.id }, data: { pausedAt: null, pausedByUserId: null } });
        await this.audit.record(
          { action: AUDIT_ACTIONS.AI_RESUMED, actorUserId: actor.id, entityType: "AiSettings", entityId: company.id, companyId: company.id },
          tx,
        );
        return;
      }
      if (current.pausedAt) return;
      await tx.aiSettings.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, timezone: company.timezone, pausedAt: now, pausedByUserId: actor.id },
        update: { pausedAt: now, pausedByUserId: actor.id },
      });
      const waiting = await tx.aiReplyTask.findMany({
        where: { companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
        distinct: ["conversationId"],
        select: { conversationId: true },
      });
      await tx.aiReplyTask.updateMany({
        where: { companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "CANCELED", outcome: "AI_PAUSED", lockedUntil: null, finishedAt: now },
      });
      for (const { conversationId } of waiting) {
        const { count } = await tx.conversation.updateMany({
          where: { id: conversationId, companyId: company.id, mode: "AI", status: "OPEN" },
          data: { mode: "HUMAN", modeBeforePause: null, aiHandoffReason: "AI_PAUSED", aiHandoffAt: now, ...queuedData(now) },
        });
        if (count === 0) continue;
        requeued += 1;
        await markQueued(tx, conversationId, now);
        await this.audit.record(
          { action: AUDIT_ACTIONS.CONVERSATION_QUEUED, actorUserId: actor.id, entityType: "Conversation", entityId: conversationId, companyId: company.id, metadata: { reason: "AI_PAUSED" } },
          tx,
        );
      }
      await this.audit.record(
        { action: AUDIT_ACTIONS.AI_PAUSED, actorUserId: actor.id, entityType: "AiSettings", entityId: company.id, companyId: company.id, metadata: { requeuedConversations: requeued } },
        tx,
      );
    });
    if (requeued > 0) this.events.emitHumanQueued(company.id);
    return this.status(company, actor, membership);
  }
}
