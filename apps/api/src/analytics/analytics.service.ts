import { Injectable } from "@nestjs/common";
import type { Company } from "@arthur-ai/database";
import {
  PLATFORM_TIMEZONE,
  type AdminCompanyAnalytics,
  type AnalyticsQuery,
  type CompanyAnalyticsReport,
  type PlatformAnalyticsReport,
  type TeamSummary,
} from "@arthur-ai/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AnalyticsQueriesService, type Scope } from "./analytics-queries.service.js";
import { periodInfo, referenceInstant, resolveWindow, safeTimeZone, type ReportWindow } from "./period.js";

/**
 * Monta os relatórios. Empresa: fuso da empresa, só dados operacionais (nada de consumo ou custo).
 * Plataforma e consulta por empresa do SUPERADMIN: fuso de referência da plataforma, com consumo da IA.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: AnalyticsQueriesService,
  ) {}

  window(query: AnalyticsQuery, timezone: string): Promise<ReportWindow> {
    return resolveWindow(this.prisma, query.period, timezone, referenceInstant(query.at));
  }

  private async operational(window: ReportWindow, companyId: Scope) {
    const [{ cycles, team }, closed, current, daily] = await Promise.all([
      this.queries.cycles(window, companyId),
      this.queries.closed(window, companyId),
      this.queries.current(companyId),
      this.queries.daily(window, companyId),
    ]);
    const fullTeam: TeamSummary = { ...team, humanClosed: closed.withHuman, humanInProgress: current.withAgent };
    return { cycles, closed, current, daily, team: fullTeam };
  }

  /** OWNER/ADMIN: a empresa vem SEMPRE do CompanyAccessGuard. O objeto é montado campo a campo (sem custos). */
  async companyReport(company: Company, query: AnalyticsQuery): Promise<CompanyAnalyticsReport> {
    const window = await this.window(query, safeTimeZone(company.timezone));
    const data = await this.operational(window, company.id);
    return {
      scope: "company",
      company: { id: company.id, name: company.name },
      generatedAt: window.to.toISOString(),
      period: periodInfo(window),
      cycles: data.cycles,
      closed: data.closed,
      current: data.current,
      team: data.team,
      daily: data.daily,
    };
  }

  async platformReport(query: AnalyticsQuery): Promise<PlatformAnalyticsReport> {
    const window = await this.window(query, PLATFORM_TIMEZONE);
    const [data, messages, companies, bySource, byCompany] = await Promise.all([
      this.operational(window, null),
      this.queries.messages(window, null),
      this.queries.companies(window),
      this.queries.aiUsage(window, null),
      this.queries.byCompany(window),
    ]);
    return {
      scope: "platform",
      generatedAt: window.to.toISOString(),
      period: periodInfo(window),
      companies,
      ...data,
      messages,
      ai: { currency: "USD", bySource },
      byCompany,
    };
  }

  /** SUPERADMIN consultando UMA empresa: mesmo fuso e mesmas regras da tabela por empresa. */
  async adminCompanyReport(company: Company, query: AnalyticsQuery): Promise<AdminCompanyAnalytics> {
    const window = await this.window(query, PLATFORM_TIMEZONE);
    const [data, messages, bySource] = await Promise.all([
      this.operational(window, company.id),
      this.queries.messages(window, company.id),
      this.queries.aiUsage(window, company.id),
    ]);
    return {
      scope: "admin-company",
      company: { id: company.id, name: company.name, status: company.status },
      generatedAt: window.to.toISOString(),
      period: periodInfo(window),
      ...data,
      messages,
      ai: { currency: "USD", bySource },
    };
  }
}
