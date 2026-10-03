import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { TeamModule } from "../team/team.module.js";
import { CompanySettingsService } from "./company-settings.service.js";
import { LogoService } from "./logo.service.js";
import { PlatformService } from "./platform.service.js";
import { AdminPlatformController, CompanySettingsController, SupportController } from "./settings.controller.js";
import { SuspensionService } from "./suspension.service.js";

/**
 * Fase 7: configurações da empresa (abas), permissões individuais, logotipo, administração da plataforma
 * (suspensão, contatos de suporte, limite padrão da IA, estado das integrações). As regras de execução (horários,
 * mensagens, pausa) ficam em runtime.ts e são lidas pelos fluxos das fases anteriores.
 */
@Module({
  imports: [TeamModule, AiModule],
  controllers: [CompanySettingsController, SupportController, AdminPlatformController],
  providers: [CompanySettingsService, LogoService, PlatformService, SuspensionService],
  exports: [PlatformService],
})
export class SettingsModule {}
