import { Module } from "@nestjs/common";
import { CloudApiClient } from "./cloud-api.client.js";
import { ConversationEvents } from "./conversation-events.js";
import { WebhookIngestService } from "./webhook-ingest.service.js";
import { WebhookProcessorService } from "./webhook-processor.service.js";
import { WhatsAppAccountsService } from "./whatsapp-accounts.service.js";
import { WhatsAppAdminController, WhatsAppCompanyController } from "./whatsapp-admin.controller.js";
import { WhatsAppOutboundService } from "./whatsapp-outbound.service.js";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller.js";
import { WhatsAppWorker } from "./whatsapp-worker.service.js";

@Module({
  controllers: [WhatsAppWebhookController, WhatsAppAdminController, WhatsAppCompanyController],
  providers: [
    CloudApiClient,
    ConversationEvents,
    WebhookIngestService,
    WebhookProcessorService,
    WhatsAppAccountsService,
    WhatsAppOutboundService,
    WhatsAppWorker,
  ],
  // Fase 4: a IA assina ConversationEvents e envia pelo WhatsAppOutboundService.
  exports: [WhatsAppOutboundService, ConversationEvents, WhatsAppWorker],
})
export class WhatsAppModule {}
