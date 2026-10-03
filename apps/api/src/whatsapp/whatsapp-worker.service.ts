import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WebhookProcessorService } from "./webhook-processor.service.js";
import { WhatsAppOutboundService } from "./whatsapp-outbound.service.js";

const BATCH = 20;
const MAX_EVENT_ATTEMPTS = 5;
// Status de mensagem ainda desconhecida: tenta de novo algumas vezes (corrida com o envio).
const MAX_UNKNOWN_STATUS_ATTEMPTS = 3;
const LOCK_SECONDS = 120;

interface ClaimedEvent {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * Processamento em segundo plano, dentro da própria API, usando o PostgreSQL como fila persistente
 * (sem Redis). FOR UPDATE SKIP LOCKED permite várias instâncias sem processar o mesmo evento duas vezes.
 * Se a API cair, os eventos pendentes são retomados no próximo ciclo.
 */
@Injectable()
export class WhatsAppWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WebhookProcessorService,
    private readonly outbound: WhatsAppOutboundService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    const interval = this.env.whatsapp.workerIntervalMs;
    if (!this.env.whatsapp.enabled || interval === 0) return;
    this.timer = setInterval(() => {
      this.kick();
    }, interval);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Dispara um ciclo sem esperar (usado logo após receber um webhook). */
  kick(): void {
    this.running ??= this.runOnce().finally(() => {
      this.running = null;
    });
  }

  /** Processa até não haver trabalho vencido. Usado nos testes e em scripts. */
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
      return (await this.processEvents()) + (await this.processOutbound());
    } catch (error) {
      this.logger.error(`Ciclo do worker do WhatsApp falhou: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async processEvents(): Promise<number> {
    const events = await this.prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE "WhatsAppWebhookEvent"
         SET "lockedUntil" = now() + make_interval(secs => ${LOCK_SECONDS}), "attempts" = "attempts" + 1
       WHERE "id" IN (
         SELECT "id" FROM "WhatsAppWebhookEvent"
          WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
            AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
          ORDER BY "receivedAt"
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING "id", "payload", "attempts"`;

    for (const event of events) {
      try {
        const outcome = await this.processor.process(event.payload);
        const retry = outcome.retryLater && event.attempts < MAX_UNKNOWN_STATUS_ATTEMPTS;
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: event.id },
          data: retry
            ? { companyId: outcome.companyId, lockedUntil: null, nextAttemptAt: new Date(Date.now() + 30_000) }
            : {
                companyId: outcome.companyId,
                status: outcome.result === "processed" ? "PROCESSED" : "IGNORED",
                ignoredReason: outcome.ignoredReason,
                lockedUntil: null,
                processedAt: new Date(),
              },
        });
      } catch (error) {
        // Só a mensagem de erro (sem payload, que tem dados de clientes).
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Falha ao processar evento ${event.id} (tentativa ${event.attempts}): ${message}`);
        const exhausted = event.attempts >= MAX_EVENT_ATTEMPTS;
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: exhausted ? "FAILED" : "PENDING",
            lockedUntil: null,
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + 2 ** event.attempts * 5_000),
          },
        });
      }
    }
    return events.length;
  }

  private async processOutbound(): Promise<number> {
    const ids = await this.outbound.dueMessageIds(BATCH);
    for (const id of ids) await this.outbound.dispatch(id);
    return ids.length;
  }
}
