import { Module } from "@nestjs/common";
import { AdminAnalyticsController, CompanyAnalyticsController, ReportExporter } from "./analytics.controller.js";
import { AnalyticsQueriesService } from "./analytics-queries.service.js";
import { AnalyticsService } from "./analytics.service.js";
import { ExportRateLimiter } from "./export-rate-limiter.js";

/** Fase 6: Analytics e relatórios (somente leitura; os marcos são gravados pelos fluxos via cycle-tracker). */
@Module({
  controllers: [CompanyAnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, AnalyticsQueriesService, ExportRateLimiter, ReportExporter],
  exports: [AnalyticsQueriesService],
})
export class AnalyticsModule {}
