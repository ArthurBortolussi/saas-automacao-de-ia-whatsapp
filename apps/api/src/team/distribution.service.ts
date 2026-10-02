import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AssignmentStartReason,
  Company,
  CompanyMember,
  ConversationCloseReason,
  ConversationStatus,
  Prisma,
  User,
} from "@arthur-ai/database";
import { isServiceWindowOpen, QUEUE_WAITING_MESSAGE, type EligibleAssignee } from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppOutboundService } from "../whatsapp/whatsapp-outbound.service.js";
import { endOpenAssignment, queuedData, releasedData } from "./conversation-state.js";
import { lockCompanyTeam } from "./team-lock.js";

const NOT_FOUND = "Conversa não encontrada.";
const DEFAULT_INACTIVITY_MINUTES = 240;

/** O aviso de fila deixou de valer (a conversa saiu da fila ou já foi avisada): nada é enviado. */
class NoticeInvalidatedError extends Error {}

export function isTeamManager(membership: CompanyMember | null): boolean {
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}

interface Candidate {
  userId: string;
  name: string;
  load: number;
  maxConcurrent: number;
}

/**
 * Atendimento humano: distribuição automática, fila, transferências e encerramentos.
 * Toda mudança de atribuição acontece sob a trava da empresa (lockCompanyTeam), dentro de uma transação.
 */
@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbound: WhatsAppOutboundService,
  ) {}

  /**
   * Funcionários que podem receber conversas agora: da empresa, ativos, com permissão de atender, AVAILABLE e com
   * vaga. Ordem da escolha: menos atendimentos; empate → quem recebeu há mais tempo (rotação); depois o id.
   */
  async candidates(tx: Prisma.TransactionClient, companyId: string): Promise<Candidate[]> {
    return tx.$queryRaw<Candidate[]>`
      SELECT * FROM (
        SELECT m."userId", u."name", m."maxConcurrent", m."lastAssignedAt",
               (SELECT count(*)::int FROM "Conversation" c
                 WHERE c."companyId" = m."companyId" AND c."assignedUserId" = m."userId" AND c."status" = 'ASSIGNED') AS "load"
          FROM "CompanyMember" m
          JOIN "User" u ON u."id" = m."userId"
         WHERE m."companyId" = ${companyId}::uuid AND m."availability" = 'AVAILABLE' AND m."canAttend" AND u."status" = 'ACTIVE'
      ) e
      WHERE e."load" < e."maxConcurrent"
      ORDER BY e."load" ASC, e."lastAssignedAt" ASC NULLS FIRST, e."userId" ASC`;
  }

  /** Distribui a fila da empresa (ordem de chegada) enquanto houver conversa elegível e funcionário com vaga. */
  async distribute(companyId: string): Promise<number> {
    let assigned = 0;
    for (;;) {
      const done = await this.prisma.$transaction(async (tx) => {
        await lockCompanyTeam(tx, companyId);
        // Pausadas ficam na fila, mas não são distribuídas até serem reativadas.
        const next = await tx.conversation.findFirst({
          where: { companyId, status: "QUEUED", mode: "HUMAN" },
          orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (!next) return false;
        const [candidate] = await this.candidates(tx, companyId);
        if (!candidate) return false;
        await this.assign(tx, {
          companyId,
          conversationId: next.id,
          userId: candidate.userId,
          startReason: "AUTO",
          actorUserId: null,
          expectedStatus: "QUEUED",
        });
        return true;
      });
      if (!done) return assigned;
      assigned += 1;
    }
  }

  /** Atribui sob a trava; condicional ao estado esperado, então nunca atribui duas vezes. */
  async assign(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      conversationId: string;
      userId: string;
      startReason: AssignmentStartReason;
      actorUserId: string | null;
      expectedStatus: ConversationStatus;
      previousUserId?: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    const { count } = await tx.conversation.updateMany({
      where: { id: params.conversationId, companyId: params.companyId, status: params.expectedStatus },
      data: {
        status: "ASSIGNED",
        assignedUserId: params.userId,
        assignedAt: now,
        queuedAt: null,
        queueNoticeAt: null,
        queueNoticeError: null,
        // Atribuição conta como atividade: o novo responsável tem o prazo inteiro.
        lastActivityAt: now,
      },
    });
    if (count === 0) throw new ConflictException("A conversa foi alterada por outra pessoa. Atualize a página e tente novamente.");
    await tx.companyMember.update({
      where: { companyId_userId: { companyId: params.companyId, userId: params.userId } },
      data: { lastAssignedAt: now },
    });
    await tx.conversationAssignment.create({
      data: {
        companyId: params.companyId,
        conversationId: params.conversationId,
        userId: params.userId,
        startReason: params.startReason,
        actorUserId: params.actorUserId,
        assignedAt: now,
      },
    });
    const transfer = params.startReason === "TRANSFER";
    await this.audit.record(
      {
        action: transfer ? AUDIT_ACTIONS.CONVERSATION_TRANSFERRED : AUDIT_ACTIONS.CONVERSATION_ASSIGNED,
        actorUserId: params.actorUserId,
        entityType: "Conversation",
        entityId: params.conversationId,
        companyId: params.companyId,
        metadata: {
          to: params.userId,
          reason: params.startReason,
          ...(params.previousUserId ? { from: params.previousUserId } : {}),
          ...(params.expectedStatus === "QUEUED" ? { fromQueue: true } : {}),
        },
      },
      tx,
    );
  }

  /** Por que este usuário não pode receber uma conversa agora (null = pode). Sempre conferido sob a trava. */
  private async ineligibility(tx: Prisma.TransactionClient, companyId: string, userId: string): Promise<HttpException | null> {
    const member = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      include: { user: { select: { status: true } } },
    });
    // Usuário de outra empresa (ou inexistente) responde igual: não revela nada.
    if (!member) return new NotFoundException("Funcionário não encontrado nesta empresa.");
    if (member.user.status !== "ACTIVE") return new ConflictException("Este funcionário está desativado.");
    if (!member.canAttend) return new ConflictException("Este funcionário não está habilitado para receber atendimentos.");
    if (member.availability !== "AVAILABLE") return new ConflictException("Este funcionário não está disponível agora.");
    const load = await tx.conversation.count({ where: { companyId, assignedUserId: userId, status: "ASSIGNED" } });
    if (load >= member.maxConcurrent) return new ConflictException("Este funcionário atingiu o limite de atendimentos simultâneos.");
    return null;
  }

  /** Destinatários elegíveis para transferir (a tela mostra só estes; a transferência confere tudo de novo). */
  async eligibleAssignees(company: Company, excludeUserId: string | null): Promise<EligibleAssignee[]> {
    const rows = await this.candidates(this.prisma, company.id);
    return rows
      .filter((row) => row.userId !== excludeUserId)
      .map((row) => ({ userId: row.userId, name: row.name, activeConversations: row.load, maxConcurrent: row.maxConcurrent }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  /**
   * Transferência manual. Funcionário: só as próprias conversas. OWNER/ADMIN: qualquer conversa humana da empresa
   * (inclusive na fila ou sem responsável). Destinatário: mesma empresa, ativo, habilitado, disponível e com vaga.
   */
  async transfer(company: Company, conversationId: string, toUserId: string, actor: User, membership: CompanyMember | null): Promise<void> {
    if (!membership) throw new ForbiddenException("O Superadmin acompanha os atendimentos, mas não os transfere.");
    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const conversation = await tx.conversation.findUnique({
        where: { id_companyId: { id: conversationId, companyId: company.id } },
        select: { status: true, mode: true, assignedUserId: true },
      });
      if (!conversation) throw new NotFoundException(NOT_FOUND);
      if (conversation.status === "CLOSED") throw new ConflictException("Este atendimento já foi finalizado.");
      if (conversation.mode !== "HUMAN") throw new ConflictException("Só conversas em atendimento humano podem ser transferidas.");
      if (!isTeamManager(membership) && conversation.assignedUserId !== actor.id) {
        throw new ForbiddenException("Você só pode transferir as conversas atribuídas a você.");
      }
      if (conversation.assignedUserId === toUserId) throw new ConflictException("A conversa já está com este funcionário.");
      const problem = await this.ineligibility(tx, company.id, toUserId);
      if (problem) throw problem;

      if (conversation.assignedUserId) await endOpenAssignment(tx, conversationId, "TRANSFERRED");
      await this.assign(tx, {
        companyId: company.id,
        conversationId,
        userId: toUserId,
        startReason: "TRANSFER",
        actorUserId: actor.id,
        expectedStatus: conversation.status,
        previousUserId: conversation.assignedUserId,
      });
    });
    // A vaga de quem transferiu foi liberada.
    await this.distribute(company.id);
  }

  /** Encerramento manual: o responsável encerra o próprio atendimento; OWNER/ADMIN qualquer atendimento humano. */
  async closeManually(company: Company, conversationId: string, actor: User, membership: CompanyMember | null): Promise<void> {
    if (!membership) throw new ForbiddenException("O Superadmin acompanha os atendimentos, mas não os finaliza.");
    await this.prisma.$transaction(async (tx) => {
      await lockCompanyTeam(tx, company.id);
      const conversation = await tx.conversation.findUnique({
        where: { id_companyId: { id: conversationId, companyId: company.id } },
        select: { status: true, mode: true, assignedUserId: true },
      });
      if (!conversation) throw new NotFoundException(NOT_FOUND);
      if (conversation.status === "CLOSED") throw new ConflictException("Este atendimento já foi finalizado.");
      if (conversation.mode === "AI") throw new ConflictException("Conversas com a IA não são finalizadas manualmente. Assuma o atendimento antes.");
      if (!isTeamManager(membership) && conversation.assignedUserId !== actor.id) {
        throw new ForbiddenException("Você só pode finalizar os atendimentos atribuídos a você.");
      }
      await this.closeInTx(tx, company.id, conversationId, conversation.status, conversation.assignedUserId, "MANUAL", actor.id);
    });
    await this.distribute(company.id);
  }

  private async closeInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    conversationId: string,
    expectedStatus: ConversationStatus,
    previousUserId: string | null,
    reason: ConversationCloseReason,
    actorUserId: string | null,
    extraWhere: Prisma.ConversationWhereInput = {},
  ): Promise<boolean> {
    const now = new Date();
    const { count } = await tx.conversation.updateMany({
      where: { id: conversationId, companyId, status: expectedStatus, ...extraWhere },
      data: { ...releasedData, status: "CLOSED", closedAt: now, closeReason: reason, closedByUserId: actorUserId },
    });
    if (count === 0) return false;
    if (previousUserId) await endOpenAssignment(tx, conversationId, "CLOSED", now);
    // Nada da IA fica pendente numa conversa encerrada.
    await tx.aiReplyTask.updateMany({
      where: { conversationId, companyId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELED", outcome: "CONVERSATION_CLOSED", lockedUntil: null, finishedAt: now },
    });
    await this.audit.record(
      {
        action: AUDIT_ACTIONS.CONVERSATION_CLOSED,
        actorUserId,
        entityType: "Conversation",
        entityId: conversationId,
        companyId,
        metadata: { reason, ...(previousUserId ? { previousUserId } : {}), fromStatus: expectedStatus },
      },
      tx,
    );
    return true;
  }

  /**
   * Encerramento automático por inatividade. Critério: atendimento ATRIBUÍDO cuja última atividade relevante
   * (mensagem recebida ou enviada, ou a própria atribuição) é mais antiga que o prazo da empresa. Não encerra se
   * houver mensagem ainda sendo enviada. A gravação é condicional à mesma última atividade lida: se chegou uma
   * mensagem no meio do caminho (ela trava a linha da conversa e atualiza a atividade), nada é encerrado.
   */
  async closeInactive(limit = 50): Promise<number> {
    const candidates = await this.prisma.$queryRaw<{ id: string; companyId: string; assignedUserId: string; lastActivityAt: Date }[]>`
      SELECT c."id", c."companyId", c."assignedUserId", c."lastActivityAt"
        FROM "Conversation" c
        LEFT JOIN "TeamSettings" t ON t."companyId" = c."companyId"
       WHERE c."status" = 'ASSIGNED' AND c."lastActivityAt" IS NOT NULL
         AND c."lastActivityAt" < now() - make_interval(mins => COALESCE(t."inactivityTimeoutMinutes", ${DEFAULT_INACTIVITY_MINUTES}))
         AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c."id" AND m."deliveryStatus" = 'PENDING')
       ORDER BY c."lastActivityAt"
       LIMIT ${limit}`;
    const companies = new Set<string>();
    let closed = 0;
    for (const candidate of candidates) {
      const done = await this.prisma.$transaction(async (tx) => {
        await lockCompanyTeam(tx, candidate.companyId);
        const sending = await tx.message.count({ where: { conversationId: candidate.id, deliveryStatus: "PENDING" } });
        if (sending > 0) return false;
        return this.closeInTx(tx, candidate.companyId, candidate.id, "ASSIGNED", candidate.assignedUserId, "INACTIVITY", null, {
          assignedUserId: candidate.assignedUserId,
          lastActivityAt: candidate.lastActivityAt,
        });
      });
      if (done) {
        closed += 1;
        companies.add(candidate.companyId);
      }
    }
    for (const companyId of companies) await this.distribute(companyId);
    return closed;
  }

  /** Empresas com conversas aguardando na fila (recuperação após reinício e ciclo periódico). */
  async companiesWithQueue(): Promise<string[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { status: "QUEUED", mode: "HUMAN" },
      distinct: ["companyId"],
      select: { companyId: true },
    });
    return rows.map((row) => row.companyId);
  }

  /**
   * Aviso de espera: uma vez por entrada na fila, pelo envio do WhatsApp da Fase 3 (mesmas regras de janela e de
   * falha). A marcação acontece na mesma transação que grava a mensagem, então nunca sai duas vezes. Quando não é
   * permitido enviar, a conversa continua na fila e o motivo fica registrado.
   */
  async sendQueueNotices(limit = 20): Promise<number> {
    const pending = await this.prisma.conversation.findMany({
      where: { status: "QUEUED", mode: "HUMAN", queueNoticeAt: null, queueNoticeError: null },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, companyId: true, channel: true, queuedAt: true, lastInboundAt: true, company: true },
    });
    for (const conversation of pending) {
      const queuedAt = conversation.queuedAt;
      if (!queuedAt) continue;
      const markError = (code: string) =>
        this.prisma.conversation.updateMany({
          where: { id: conversation.id, status: "QUEUED", queuedAt, queueNoticeAt: null },
          data: { queueNoticeError: code },
        });
      // Conversa interna: o canal não envia nada ao cliente.
      if (conversation.channel !== "WHATSAPP") {
        await markError("INTERNAL_CHANNEL");
        continue;
      }
      if (conversation.company.status === "PAUSED" || conversation.company.status === "INACTIVE") {
        await markError("COMPANY_SUSPENDED");
        continue;
      }
      if (!isServiceWindowOpen(conversation.lastInboundAt)) {
        await markError("WINDOW_CLOSED");
        continue;
      }
      try {
        await this.outbound.send(conversation.company, conversation.id, QUEUE_WAITING_MESSAGE, {
          type: "SYSTEM",
          inTransaction: async (tx) => {
            const { count } = await tx.conversation.updateMany({
              where: { id: conversation.id, status: "QUEUED", queuedAt, queueNoticeAt: null },
              data: { queueNoticeAt: new Date() },
            });
            if (count === 0) throw new NoticeInvalidatedError();
          },
        });
      } catch (error) {
        if (error instanceof NoticeInvalidatedError) continue;
        if (error instanceof ServiceUnavailableException) await markError("WHATSAPP_UNAVAILABLE");
        else if (error instanceof HttpException) await markError("SEND_REJECTED");
        else this.logger.error(`Aviso de fila falhou na conversa ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return pending.length;
  }

  /** Funcionário desativado: as conversas dele voltam para a fila (sem novo aviso ao cliente). */
  async requeueMemberConversations(tx: Prisma.TransactionClient, companyId: string, userId: string, actorUserId: string): Promise<number> {
    const conversations = await tx.conversation.findMany({
      where: { companyId, assignedUserId: userId, status: "ASSIGNED" },
      select: { id: true },
    });
    const now = new Date();
    for (const conversation of conversations) {
      await endOpenAssignment(tx, conversation.id, "REQUEUED", now);
      await tx.conversation.updateMany({
        where: { id: conversation.id, companyId, status: "ASSIGNED" },
        data: { ...queuedData(now), queueNoticeError: "REQUEUED" },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.CONVERSATION_QUEUED,
          actorUserId,
          entityType: "Conversation",
          entityId: conversation.id,
          companyId,
          metadata: { reason: "MEMBER_DEACTIVATED", previousUserId: userId },
        },
        tx,
      );
    }
    return conversations.length;
  }
}
