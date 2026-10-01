import { Module } from "@nestjs/common";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

@Module({
  imports: [WhatsAppModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
