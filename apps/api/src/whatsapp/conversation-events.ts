import { Injectable, Logger } from "@nestjs/common";

export interface InboundMessageEvent {
  companyId: string;
  conversationId: string;
  messageId: string;
}

type Listener = (event: InboundMessageEvent) => Promise<void> | void;

/**
 * Ponto de extensão para a Fase 4: o serviço de IA vai assinar este evento, conferir o modo
 * (aiMayReply) e responder pelo mesmo WhatsAppOutboundService. Nesta fase não há assinantes.
 * Emitido somente depois do commit; falha de um ouvinte não afeta o recebimento.
 */
@Injectable()
export class ConversationEvents {
  private readonly logger = new Logger(ConversationEvents.name);
  private readonly listeners: Listener[] = [];

  onInboundMessage(listener: Listener): void {
    this.listeners.push(listener);
  }

  emitInboundMessage(event: InboundMessageEvent): void {
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.logger.error(`Ouvinte de mensagem recebida falhou: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
  }
}
