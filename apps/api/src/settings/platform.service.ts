import { Inject, Injectable } from "@nestjs/common";
import type { User } from "@arthur-ai/database";
import {
  aiUsageLevel,
  supportEmailUrl,
  supportWhatsAppUrl,
  type AdminAlertsResponse,
  type AdminPlatformSettingsResponse,
  type AiLimitAlertRow,
  type IntegrationsStatus,
  type PlatformSettingsView,
  type SupportContacts,
  type UpdatePlatformSettingsInput,
} from "@arthur-ai/shared";
import { AiBudgetService } from "../ai/ai-budget.service.js";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

const SINGLETON = 1;

/** FASE 7: configuração global (contatos de suporte, limite padrão da IA) e estado básico das integrações. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly budget: AiBudgetService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async settingsView(): Promise<PlatformSettingsView> {
    const row = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON } });
    return {
      supportEmail: row?.supportEmail ?? null,
      supportWhatsapp: row?.supportWhatsapp ?? null,
      defaultAiMonthlyLimitUsd: row?.defaultAiMonthlyLimitUsd?.toFixed(2) ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** Contatos públicos do suporte (tela de empresa suspensa). Nada interno: só e-mail e WhatsApp com links seguros. */
  async supportContacts(): Promise<SupportContacts> {
    const settings = await this.settingsView();
    return {
      email: settings.supportEmail,
      whatsapp: settings.supportWhatsapp,
      emailUrl: supportEmailUrl(settings.supportEmail),
      whatsappUrl: supportWhatsAppUrl(settings.supportWhatsapp),
    };
  }

  async adminView(): Promise<AdminPlatformSettingsResponse> {
    const [settings, integrations, aiLimitAlerts] = await Promise.all([this.settingsView(), this.integrations(), this.limitAlerts()]);
    return { settings, integrations, aiLimitAlerts };
  }

  /**
   * Limite padrão: vale para empresas que ainda não tinham limite, no momento em que a IA é habilitada. Mudá-lo não
   * altera nenhuma empresa que já tem limite (individual ou herdado antes).
   */
  async update(data: UpdatePlatformSettingsInput, actor: User): Promise<AdminPlatformSettingsResponse> {
    const values = {
      ...(data.supportEmail !== undefined ? { supportEmail: data.supportEmail } : {}),
      ...(data.supportWhatsapp !== undefined ? { supportWhatsapp: data.supportWhatsapp } : {}),
      ...(data.defaultAiMonthlyLimitUsd !== undefined
        ? { defaultAiMonthlyLimitUsd: data.defaultAiMonthlyLimitUsd === null ? null : data.defaultAiMonthlyLimitUsd.toFixed(2) }
        : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.platformSettings.findUnique({ where: { id: SINGLETON } });
      await tx.platformSettings.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...values }, update: values });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.PLATFORM_SETTINGS_UPDATED,
          actorUserId: actor.id,
          entityType: "PlatformSettings",
          entityId: String(SINGLETON),
          metadata: {
            fields: Object.keys(values),
            ...(values.defaultAiMonthlyLimitUsd !== undefined
              ? { defaultAiMonthlyLimitFrom: before?.defaultAiMonthlyLimitUsd?.toFixed(2) ?? null, defaultAiMonthlyLimitTo: values.defaultAiMonthlyLimitUsd }
              : {}),
            ...(values.supportEmail !== undefined ? { supportEmail: values.supportEmail } : {}),
            ...(values.supportWhatsapp !== undefined ? { supportWhatsapp: values.supportWhatsapp } : {}),
          },
        },
        tx,
      );
    });
    return this.adminView();
  }

  /**
   * Estado BÁSICO, só com fatos verificáveis: variáveis configuradas, ambiente (oficial/simulado), contas por estado
   * e a última atividade observada. Nada aqui prova uma conexão real: no simulador, sucesso não é validação.
   */
  async integrations(): Promise<IntegrationsStatus> {
    const { whatsapp, ai } = this.env;
    const [accounts, lastWebhook, lastSent, enabled, paused, lastOfficial, lastSimulated] = await Promise.all([
      this.prisma.whatsAppAccount.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.whatsAppWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
      this.prisma.message.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      this.prisma.aiSettings.count({ where: { enabled: true } }),
      this.prisma.aiSettings.count({ where: { enabled: true, pausedAt: { not: null } } }),
      this.prisma.aiRun.findFirst({ where: { apiSource: "OFFICIAL", result: { not: "ERROR" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      this.prisma.aiRun.findFirst({ where: { apiSource: "SIMULATED", result: { not: "ERROR" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const countOf = (status: string) => accounts.find((row) => row.status === status)?._count._all ?? 0;
    return {
      whatsapp: {
        configured: whatsapp.enabled,
        environment: !whatsapp.enabled ? "NOT_CONFIGURED" : whatsapp.simulated ? "SIMULATED" : "OFFICIAL",
        graphApiVersion: whatsapp.graphApiVersion,
        accounts: { active: countOf("ACTIVE"), pending: countOf("PENDING"), error: countOf("ERROR"), disabled: countOf("DISABLED") },
        lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
        lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
        observedSuccess: Boolean(lastSent),
      },
      anthropic: {
        configured: ai.configured,
        environment: !ai.configured ? "NOT_CONFIGURED" : ai.simulated ? "SIMULATED" : "OFFICIAL",
        model: ai.model,
        companiesEnabled: enabled,
        companiesPaused: paused,
        lastOfficialSuccessAt: lastOfficial?.createdAt.toISOString() ?? null,
        lastSimulatedSuccessAt: lastSimulated?.createdAt.toISOString() ?? null,
      },
    };
  }

  async alerts(): Promise<AdminAlertsResponse> {
    const [suspendedCompanies, aiLimitAlerts] = await Promise.all([this.prisma.company.count({ where: { status: "PAUSED" } }), this.limitAlerts()]);
    return { suspendedCompanies, aiLimitAlerts };
  }

  /** Empresas com consumo do mês em 80% ou mais do limite (origem aplicada por este servidor). */
  async limitAlerts(): Promise<AiLimitAlertRow[]> {
    const limited = await this.prisma.aiSettings.findMany({
      where: { monthlyLimitUsd: { not: null } },
      select: { monthlyLimitUsd: true, company: { select: { id: true, name: true, timezone: true } } },
    });
    const rows: AiLimitAlertRow[] = [];
    for (const { monthlyLimitUsd, company } of limited) {
      if (!monthlyLimitUsd) continue;
      const usage = await this.budget.monthUsage(company.id, company.timezone);
      const spent = usage.spent[this.budget.enforcedSource].usd;
      const level = aiUsageLevel(spent.toNumber(), monthlyLimitUsd.toNumber());
      if (level !== "NEAR_LIMIT" && level !== "LIMIT_REACHED") continue;
      rows.push({
        companyId: company.id,
        name: company.name,
        limitUsd: monthlyLimitUsd.toFixed(2),
        spentUsd: spent.toFixed(6),
        percent: Math.floor(spent.dividedBy(monthlyLimitUsd).times(100).toNumber()),
        level,
        source: this.budget.enforcedSource,
      });
    }
    return rows.sort((a, b) => b.percent - a.percent);
  }
}
