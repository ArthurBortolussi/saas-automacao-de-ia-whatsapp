import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { DistributionService } from "./distribution.service.js";
import { TeamController } from "./team.controller.js";
import { TeamWorker } from "./team-worker.service.js";
import { TeamService } from "./team.service.js";

/** Fase 5: equipe, disponibilidade, distribuição automática, fila, transferências e encerramentos. */
@Module({
  imports: [WhatsAppModule, CompaniesModule],
  controllers: [TeamController],
  providers: [DistributionService, TeamService, TeamWorker],
  exports: [DistributionService, TeamWorker],
})
export class TeamModule {}
