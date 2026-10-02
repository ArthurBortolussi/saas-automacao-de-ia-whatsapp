import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { AiAdminController, AiCompanyController } from "./ai.controller.js";
import { AiModelClient } from "./ai-model.client.js";
import { AiReplyService } from "./ai-reply.service.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AiUsageService } from "./ai-usage.service.js";
import { AiWorker } from "./ai-worker.service.js";
import { KnowledgeService } from "./knowledge.service.js";

/** Fase 4: atendimento automático com o Claude, base de conhecimento e consumo. Envia pelo WhatsApp da Fase 3. */
@Module({
  imports: [WhatsAppModule, AnalyticsModule],
  controllers: [AiCompanyController, AiAdminController],
  providers: [AiModelClient, AiSettingsService, KnowledgeService, AiUsageService, AiReplyService, AiWorker],
  exports: [AiWorker, AiModelClient],
})
export class AiModule {}
