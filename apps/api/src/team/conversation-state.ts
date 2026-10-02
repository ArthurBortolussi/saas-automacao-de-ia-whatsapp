import type { AssignmentEndReason, Prisma } from "@arthur-ai/database";

/** Dados que colocam uma conversa na fila humana (nova entrada: o aviso de espera volta a valer). */
export function queuedData(now: Date) {
  return {
    status: "QUEUED",
    queuedAt: now,
    queueNoticeAt: null,
    queueNoticeError: null,
    assignedUserId: null,
    assignedAt: null,
  } as const satisfies Prisma.ConversationUncheckedUpdateManyInput;
}

/** Dados que tiram a conversa da fila e de qualquer responsável, sem encerrá-la. */
export const releasedData = {
  status: "OPEN",
  queuedAt: null,
  queueNoticeAt: null,
  queueNoticeError: null,
  assignedUserId: null,
  assignedAt: null,
} as const satisfies Prisma.ConversationUncheckedUpdateManyInput;

/** Fecha o período de responsabilidade aberto da conversa (histórico). */
export async function endOpenAssignment(
  tx: Prisma.TransactionClient,
  conversationId: string,
  endReason: AssignmentEndReason,
  at: Date = new Date(),
): Promise<void> {
  await tx.conversationAssignment.updateMany({ where: { conversationId, endedAt: null }, data: { endedAt: at, endReason } });
}
