import { Module } from "@nestjs/common";
import { TeamModule } from "../team/team.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

@Module({
  imports: [WhatsAppModule, TeamModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
