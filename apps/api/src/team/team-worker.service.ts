import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { ConversationEvents } from "../whatsapp/conversation-events.js";
import { DistributionService } from "./distribution.service.js";

/**
 * Atendimento humano em segundo plano, no processo da API (sem Redis): a cada ciclo, (1) distribui a fila das
 * empresas com conversas aguardando — o que também recupera tudo o que ficou pendente após um reinício, porque
 * a fila está gravada nas conversas —, (2) envia os avisos de espera pendentes e (3) encerra atendimentos inativos
 * (humanos pelo prazo da equipe; só com a IA pelo prazo da IA).
 * O evento em memória só antecipa o ciclo.
 */
@Injectable()
export class TeamWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TeamWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly distribution: DistributionService,
    private readonly events: ConversationEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    const interval = this.env.TEAM_WORKER_INTERVAL_MS;
    if (interval === 0) return;
    this.events.onHumanQueued(() => {
      this.kick();
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

  /** Um ciclo completo, esperando o que estiver em andamento. Usado nos testes e em scripts. */
  async drain(): Promise<void> {
    if (this.running) await this.running.catch(() => 0);
    this.running = this.runOnce();
    await this.running.finally(() => {
      this.running = null;
    });
  }

  private async runOnce(): Promise<number> {
    try {
      let work = 0;
      for (const companyId of await this.distribution.companiesWithQueue()) work += await this.distribution.distribute(companyId);
      work += await this.distribution.sendQueueNotices();
      work += await this.distribution.closeInactive();
      work += await this.distribution.closeInactiveAi();
      return work;
    } catch (error) {
      this.logger.error(`Ciclo do worker da equipe falhou: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
