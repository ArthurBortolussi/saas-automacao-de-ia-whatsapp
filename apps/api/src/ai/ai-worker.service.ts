import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConversationEvents } from "../whatsapp/conversation-events.js";
import { AiReplyService } from "./ai-reply.service.js";

// Conversas processadas em paralelo por ciclo.
const BATCH = 5;
// Reserva de um lote: maior que o pior caso de uma execução (timeout do modelo com 1 retentativa + envio).
const LOCK_MS = 5 * 60_000;

/**
 * Fila da IA no PostgreSQL (sem Redis), no mesmo processo da API.
 *
 * Agrupamento: uma conversa só é processada quando o cliente para de escrever por AI_BATCH_DELAY_MS
 * (ou quando a primeira mensagem pendente passa de AI_BATCH_MAX_WAIT_MS). Todas as tarefas pendentes
 * da conversa entram no mesmo lote (runId) e geram UMA resposta.
 *
 * Concorrência: a reserva trava a linha da conversa (FOR UPDATE SKIP LOCKED) e recusa conversas com lote
 * em andamento, então duas instâncias nunca processam a mesma conversa ao mesmo tempo. Lotes de uma API
 * que caiu ficam com a reserva vencida e são retomados no ciclo seguinte.
 */
@Injectable()
export class AiWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly replies: AiReplyService,
    private readonly events: ConversationEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    const interval = this.env.ai.workerIntervalMs;
    if (interval === 0) return;
    // O evento em memória só antecipa o ciclo; a tarefa já está gravada no banco.
    this.events.onInboundMessage(() => {
      if (this.stopped) return;
      setTimeout(() => {
        this.kick();
      }, this.env.ai.batchDelayMs + 250).unref();
    });
    this.timer = setInterval(() => {
      this.kick();
    }, interval);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  kick(): void {
    if (this.stopped) return;
    this.running ??= this.runOnce().finally(() => {
      this.running = null;
    });
  }

  /** Processa até não haver lote pronto. Usado nos testes e em scripts. */
  async drain(): Promise<void> {
    for (;;) {
      if (this.running) await this.running.catch(() => 0);
      this.running = this.runOnce();
      const done = await this.running.finally(() => {
        this.running = null;
      });
      if (done === 0) return;
    }
  }

  private async runOnce(): Promise<number> {
    try {
      const runIds = await this.claimBatch();
      await Promise.all(runIds.map((runId) => this.replies.process(runId)));
      return runIds.length;
    } catch (error) {
      this.logger.error(`Ciclo do worker da IA falhou: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async claimBatch(): Promise<string[]> {
    const delaySeconds = this.env.ai.batchDelayMs / 1000;
    const maxWaitSeconds = this.env.ai.batchMaxWaitMs / 1000;
    const candidates = await this.prisma.$queryRaw<{ conversationId: string }[]>`
      SELECT "conversationId"
        FROM "AiReplyTask"
       WHERE "status" = 'PENDING' OR ("status" = 'RUNNING' AND "lockedUntil" < now())
       GROUP BY "conversationId"
      HAVING min("nextAttemptAt") <= now()
         AND (max("createdAt") <= now() - make_interval(secs => ${delaySeconds})
              OR min("createdAt") <= now() - make_interval(secs => ${maxWaitSeconds}))
       ORDER BY min("createdAt")
       LIMIT ${BATCH}`;
    const runIds: string[] = [];
    for (const { conversationId } of candidates) {
      const runId = await this.claimConversation(conversationId);
      if (runId) runIds.push(runId);
    }
    return runIds;
  }

  private claimConversation(conversationId: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId}::uuid FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const now = new Date();
      // Releitura depois da trava: outro worker pode ter reservado esta conversa há instantes.
      const busy = await tx.aiReplyTask.count({ where: { conversationId, status: "RUNNING", lockedUntil: { gte: now } } });
      if (busy > 0) return null;
      const runId = randomUUID();
      const { count } = await tx.aiReplyTask.updateMany({
        where: { conversationId, OR: [{ status: "PENDING" }, { status: "RUNNING", lockedUntil: { lt: now } }] },
        data: { status: "RUNNING", runId, lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: { increment: 1 } },
      });
      return count > 0 ? runId : null;
    });
  }
}
