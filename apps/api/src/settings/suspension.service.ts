import { ConflictException, Injectable } from "@nestjs/common";
import type { Company, CompanyStatus, User } from "@arthur-ai/database";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { toCompanyDetail } from "../companies/company.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DistributionService } from "../team/distribution.service.js";
import { lockCompanyTeam } from "../team/team-lock.js";
import type { CompanyDetail, CompanySuspensionInput } from "@arthur-ai/shared";

/**
 * FASE 7: suspensão completa de uma empresa pelo SUPERADMIN, sem apagar nada.
 *
 * Suspensa = status PAUSED (o bloqueio de acesso já existe desde a Fase 1 no CompanyAccessGuard e é conferido a cada
 * requisição) + `suspendedAt`. Na mesma transação: tarefas da IA canceladas, mensagens ainda não enviadas marcadas
 * como falha (não saem nem depois da reativação), reservas de orçamento liberadas e sessões dos usuários da empresa
 * encerradas. Recebimento, IA, distribuição e envio conferem a suspensão dentro das próprias transações (linha da
 * empresa travada para leitura), então nada iniciado antes escapa depois do commit.
 */
@Injectable()
export class SuspensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly distribution: DistributionService,
  ) {}

  /** `confirmation`: o schema da rota exige { confirm: true } (operação crítica, confirmada também no backend). */
  async suspend(company: Company, actor: User, confirmation: CompanySuspensionInput): Promise<CompanyDetail> {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Mesma ordem de travas da distribuição (equipe → empresa): sem impasse com um ciclo em andamento.
      await lockCompanyTeam(tx, company.id);
      const [current] = await tx.$queryRaw<{ status: CompanyStatus }[]>`
        SELECT "status" FROM "Company" WHERE "id" = ${company.id}::uuid FOR UPDATE`;
      if (!current) throw new ConflictException("Empresa não encontrada.");
      if (current.status === "PAUSED") throw new ConflictException("A empresa já está suspensa.");
      const now = new Date();
      const row = await tx.company.update({
        where: { id: company.id },
        data: { status: "PAUSED", suspendedAt: now, statusBeforeSuspension: current.status },
      });
      const tasks = await tx.aiReplyTask.updateMany({
        where: { companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "CANCELED", outcome: "COMPANY_SUSPENDED", lockedUntil: null, finishedAt: now },
      });
      const messages = await tx.message.updateMany({
        where: { companyId: company.id, deliveryStatus: "PENDING" },
        data: {
          deliveryStatus: "FAILED",
          failedAt: now,
          nextSendAttemptAt: null,
          errorCode: "COMPANY_SUSPENDED",
          errorMessage: "Não enviada: a empresa foi suspensa.",
        },
      });
      await tx.aiBudgetReservation.deleteMany({ where: { companyId: company.id } });
      // Sessões dos usuários da empresa (o SUPERADMIN não perde a dele).
      const sessions = await tx.session.deleteMany({ where: { user: { globalRole: "USER", membership: { companyId: company.id } } } });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.COMPANY_SUSPENDED,
          actorUserId: actor.id,
          entityType: "Company",
          entityId: company.id,
          companyId: company.id,
          metadata: {
            previousStatus: current.status,
            canceledAiTasks: tasks.count,
            failedPendingMessages: messages.count,
            revokedSessions: sessions.count,
            confirmed: confirmation.confirm,
          },
        },
        tx,
      );
      return row;
    });
    return toCompanyDetail(updated);
  }

  /**
   * Reativação: volta ao status anterior. Nada recebido durante a suspensão é recuperado (foi descartado) e nenhuma
   * resposta automática é disparada para mensagens antigas. Conversas preservadas seguem o fluxo normal: as da fila
   * voltam a ser distribuídas (no expediente da equipe) e o prazo de inatividade recomeça na reativação.
   */
  async reactivate(company: Company, actor: User, confirmation: CompanySuspensionInput): Promise<CompanyDetail> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const [current] = await tx.$queryRaw<{ status: CompanyStatus; statusBeforeSuspension: CompanyStatus | null }[]>`
        SELECT "status", "statusBeforeSuspension" FROM "Company" WHERE "id" = ${company.id}::uuid FOR UPDATE`;
      if (!current) throw new ConflictException("Empresa não encontrada.");
      if (current.status !== "PAUSED") throw new ConflictException("A empresa não está suspensa.");
      const restored: CompanyStatus = current.statusBeforeSuspension && current.statusBeforeSuspension !== "PAUSED" ? current.statusBeforeSuspension : "ACTIVE";
      const row = await tx.company.update({
        where: { id: company.id },
        data: { status: restored, suspendedAt: null, statusBeforeSuspension: null, reactivatedAt: new Date() },
      });
      // Nenhuma tarefa da IA anterior volta a valer (mesmo que tenha sobrado alguma por corrida).
      await tx.aiReplyTask.updateMany({
        where: { companyId: company.id, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "CANCELED", outcome: "COMPANY_SUSPENDED", lockedUntil: null, finishedAt: new Date() },
      });
      await this.audit.record(
        { action: AUDIT_ACTIONS.COMPANY_REACTIVATED, actorUserId: actor.id, entityType: "Company", entityId: company.id, companyId: company.id, metadata: { status: restored, confirmed: confirmation.confirm } },
        tx,
      );
      return row;
    });
    await this.distribution.distribute(company.id);
    return toCompanyDetail(updated);
  }
}
