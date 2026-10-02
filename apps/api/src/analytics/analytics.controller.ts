import { Controller, Get, Injectable, Query, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import {
  analyticsExportQuerySchema,
  analyticsQuerySchema,
  type AdminCompanyAnalytics,
  type AnalyticsExportQuery,
  type AnalyticsQuery,
  type CompanyAnalyticsReport,
  type ExportFormat,
  type PlatformAnalyticsReport,
} from "@arthur-ai/shared";
import type { Response } from "express";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { CompanyRoles } from "../common/decorators/company-roles.decorator.js";
import { CurrentCompany, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { SuperadminGuard } from "../common/guards/superadmin.guard.js";
import { AnalyticsService } from "./analytics.service.js";
import { ExportRateLimiter } from "./export-rate-limiter.js";
import { companyContent, platformContent, type ReportContent } from "./report-content.js";
import { renderPdf } from "./report-pdf.js";
import { renderXlsx } from "./report-xlsx.js";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Gera o arquivo em memória e responde como download (nada é guardado no servidor). */
@Injectable()
export class ReportExporter {
  constructor(
    private readonly limiter: ExportRateLimiter,
    private readonly audit: AuditService,
  ) {}

  async send(
    response: Response,
    content: ReportContent,
    format: ExportFormat,
    actor: User,
    companyId: string | null,
    period: string,
  ): Promise<StreamableFile> {
    this.limiter.consume(actor.id);
    const buffer = format === "pdf" ? await renderPdf(content) : await renderXlsx(content);
    await this.audit.record({
      action: AUDIT_ACTIONS.ANALYTICS_EXPORTED,
      actorUserId: actor.id,
      entityType: "Report",
      entityId: null,
      companyId,
      metadata: { format, period, scope: companyId ? "company" : "platform" },
    });
    // Relatório com dados da empresa: nunca em cache compartilhado; o navegador não deve "adivinhar" o tipo.
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(buffer, {
      type: CONTENT_TYPES[format],
      disposition: `attachment; filename="${content.fileBase}.${format}"`,
      length: buffer.length,
    });
  }
}

/**
 * Analytics da EMPRESA: somente OWNER e ADMIN (o AGENT recebe 403 aqui, não só no menu). A empresa é a validada
 * pelo CompanyAccessGuard; nenhum parâmetro do cliente escolhe outra. Sem consumo ou custos da IA.
 */
@Controller("companies/:companyId/analytics")
@UseGuards(CompanyAccessGuard)
@CompanyRoles("OWNER", "ADMIN")
export class CompanyAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exporter: ReportExporter,
  ) {}

  @Get()
  report(@CurrentCompany() company: Company, @Query({ schema: analyticsQuerySchema }) query: AnalyticsQuery): Promise<CompanyAnalyticsReport> {
    return this.analytics.companyReport(company, query);
  }

  @Get("export")
  async export(
    @CurrentCompany() company: Company,
    @CurrentUser() user: User,
    @Query({ schema: analyticsExportQuerySchema }) query: AnalyticsExportQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const report = await this.analytics.companyReport(company, query);
    return this.exporter.send(response, companyContent(report), query.format, user, company.id, query.period);
  }
}

/** Analytics da PLATAFORMA e consumo/custos da IA: somente SUPERADMIN. */
@Controller("admin/analytics")
@UseGuards(SuperadminGuard)
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exporter: ReportExporter,
  ) {}

  @Get()
  report(@Query({ schema: analyticsQuerySchema }) query: AnalyticsQuery): Promise<PlatformAnalyticsReport> {
    return this.analytics.platformReport(query);
  }

  @Get("export")
  async export(
    @CurrentUser() user: User,
    @Query({ schema: analyticsExportQuerySchema }) query: AnalyticsExportQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const report = await this.analytics.platformReport(query);
    return this.exporter.send(response, platformContent(report), query.format, user, null, query.period);
  }

  @Get("companies/:companyId")
  @UseGuards(CompanyAccessGuard)
  company(@CurrentCompany() company: Company, @Query({ schema: analyticsQuerySchema }) query: AnalyticsQuery): Promise<AdminCompanyAnalytics> {
    return this.analytics.adminCompanyReport(company, query);
  }
}
