import type { ConversationMode } from "./enums.js";

/**
 * Fonte única das regras de quem pode responder numa conversa.
 * A futura integração com IA DEVE consultar aiMayReply() antes de enviar qualquer resposta.
 */
export function aiMayReply(mode: ConversationMode): boolean {
  return mode === "AI";
}

/** Humanos respondem apenas depois de assumir o atendimento (evita IA e humano respondendo juntos). */
export function humanMayReply(mode: ConversationMode): boolean {
  return mode === "HUMAN";
}

export const CONVERSATION_ACTIONS = ["ASSUME", "RETURN_TO_AI", "PAUSE", "RESUME"] as const;
export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];

/** Modos de origem a partir dos quais cada ação é válida. */
export const ACTION_ALLOWED_FROM: Record<ConversationAction, readonly ConversationMode[]> = {
  ASSUME: ["AI", "PAUSED"],
  RETURN_TO_AI: ["HUMAN", "PAUSED"],
  PAUSE: ["AI", "HUMAN"],
  RESUME: ["PAUSED"],
};

/** Janela de atendimento do WhatsApp: mensagens livres só até 24h após a última mensagem do cliente. */
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isServiceWindowOpen(lastInboundAt: Date | string | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < WHATSAPP_SERVICE_WINDOW_MS;
}
