import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AiTone, Company, CompanyMember, ConversationMode, Prisma, User } from "@arthur-ai/database";
import {
  DEFAULT_AI_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_AI_TIMEZONE,
  DEFAULT_HANDOFF_MESSAGE,
  isWithinAiSchedule,
  type AiSettingsView,
  type AiStatusResponse,
  type UpdateAiSettingsData,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { canManageCompanyAi } from "./ai-access.js";
import { knowledgeChars } from "./knowledge.service.js";

export interface ResolvedAiSettings {
  enabled: boolean;
  defaultConversationMode: ConversationMode;
  assistantName: string;
  tone: AiTone;
  instructions: string | null;
  handoffMessage: string | null;
  alwaysOn: boolean;
  timezone: string;
  scheduleDays: number[];
  scheduleStart: string;
  scheduleEnd: string;
  inactivityTimeoutMinutes: number;
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
  updatedAt: null,
};

type SettingsClient = Pick<PrismaService, "aiSettings"> | Prisma.TransactionClient;

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async resolve(companyId: string, client: SettingsClient = this.prisma): Promise<ResolvedAiSettings> {
    const row = await client.aiSettings.findUnique({ where: { companyId }, omit: { companyId: true, createdAt: true } });
    return row ?? DEFAULT_AI_SETTINGS;
  }

  toView(settings: ResolvedAiSettings): AiSettingsView {
    return {
      enabled: settings.enabled,
      defaultConversationMode: settings.defaultConversationMode,
      assistantName: settings.assistantName,
      tone: settings.tone,
      instructions: settings.instructions,
      handoffMessage: settings.handoffMessage,
      effectiveHandoffMessage: settings.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
      alwaysOn: settings.alwaysOn,
      timezone: settings.timezone,
      scheduleDays: settings.scheduleDays,
      scheduleStart: settings.scheduleStart,
      scheduleEnd: settings.scheduleEnd,
      inactivityTimeoutMinutes: settings.inactivityTimeoutMinutes,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
    };
  }

  async status(company: Company, user: User, membership: CompanyMember | null): Promise<AiStatusResponse> {
    const [settings, account, entries] = await Promise.all([
      this.resolve(company.id),
      this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id }, select: { status: true } }),
      this.prisma.knowledgeEntry.findMany({
        where: { companyId: company.id },
        select: { active: true, title: true, content: true, category: true },
      }),
    ]);
    const withinSchedule = isWithinAiSchedule(settings);
    const blockers: string[] = [];
    if (!settings.enabled) blockers.push("A IA está desligada para esta empresa.");
    if (!this.env.ai.configured) blockers.push("A IA não está configurada neste servidor (chave da Anthropic ausente).");
    if (!account || account.status === "DISABLED" || account.status === "ERROR") {
      blockers.push("O WhatsApp da empresa não está conectado ou está com erro.");
    }
    if (settings.enabled && !withinSchedule) blockers.push("Fora do horário de atendimento da IA.");
    if (company.status === "PAUSED" || company.status === "INACTIVE") blockers.push("A empresa está pausada ou inativa.");

    const active = entries.filter((entry) => entry.active);
    const canManage = canManageCompanyAi(user, membership);
    return {
      settings: this.toView(settings),
      platform: { configured: this.env.ai.configured, simulated: this.env.ai.simulated, model: this.env.ai.model },
      withinSchedule,
      blockers,
      knowledge: {
        total: entries.length,
        active: active.length,
        activeChars: knowledgeChars(active),
        contextLimitChars: this.env.ai.knowledgeMaxChars,
      },
      permissions: { editSettings: canManage, editAdminSettings: user.globalRole === "SUPERADMIN", editKnowledge: canManage },
    };
  }

  /**
   * Atualização parcial. O schema da rota já limita os campos (empresa não liga a IA nem muda o modo padrão).
   * Mudar o modo padrão afeta só conversas NOVAS: as existentes não são tocadas.
   */
  async update(company: Company, data: UpdateAiSettingsData, actor: User, membership: CompanyMember | null): Promise<AiStatusResponse> {
    const current = await this.resolve(company.id);
    const merged = { ...current, ...definedOnly(data) };
    if (!merged.alwaysOn && merged.scheduleStart === merged.scheduleEnd) {
      throw new BadRequestException("O horário de início da IA deve ser diferente do horário de término.");
    }
    const values = {
      enabled: merged.enabled,
      defaultConversationMode: merged.defaultConversationMode,
      assistantName: merged.assistantName,
      tone: merged.tone,
      instructions: merged.instructions,
      handoffMessage: merged.handoffMessage,
      alwaysOn: merged.alwaysOn,
      timezone: merged.timezone,
      scheduleDays: merged.scheduleDays,
      scheduleStart: merged.scheduleStart,
      scheduleEnd: merged.scheduleEnd,
      inactivityTimeoutMinutes: merged.inactivityTimeoutMinutes,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.aiSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...values }, update: values });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.AI_SETTINGS_UPDATED,
          actorUserId: actor.id,
          entityType: "AiSettings",
          entityId: company.id,
          companyId: company.id,
          // Só os nomes dos campos e os valores curtos e não sensíveis.
          metadata: {
            fields: Object.keys(definedOnly(data)),
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
            ...(data.defaultConversationMode ? { defaultConversationMode: data.defaultConversationMode } : {}),
            ...(data.inactivityTimeoutMinutes !== undefined ? { inactivityTimeoutMinutes: data.inactivityTimeoutMinutes } : {}),
          },
        },
        tx,
      );
    });
    return this.status(company, actor, membership);
  }
}

function definedOnly<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>;
}
