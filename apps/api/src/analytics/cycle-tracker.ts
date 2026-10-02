import type { ConversationCloseReason, ConversationMode, Prisma } from "@arthur-ai/database";

/**
 * Marcos do ciclo de atendimento (base do Analytics). Chamados SEMPRE dentro da transação que muda a conversa,
 * depois da gravação condicional da conversa (que trava a linha): dois eventos simultâneos da mesma conversa
 * nunca intercalam. Atuam só no ciclo ABERTO da conversa; conversa encerrada não é alterada. Marcos "primeiro X"
 * guardam o MENOR horário (LEAST ignora nulos), então relógios lidos em momentos diferentes da mesma transação
 * não invertem a ordem; contadores só somam. O Analytics só lê esta tabela: nenhuma regra de fila ou encerramento
 * é repetida aqui.
 */

type Tx = Prisma.TransactionClient;

export async function startCycle(
  tx: Tx,
  params: { companyId: string; conversationId: string; origin: "NEW_CONVERSATION" | "REOPENED"; mode: ConversationMode; at: Date },
): Promise<void> {
  await tx.conversationCycle.create({
    data: {
      companyId: params.companyId,
      conversationId: params.conversationId,
      origin: params.origin,
      startMode: params.mode,
      startedAt: params.at,
    },
  });
}

/** Entrada na fila humana: abre uma espera (se não houver uma em andamento) e registra o pedido de atendimento. */
export async function markQueued(tx: Tx, conversationId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle"
       SET "firstQueuedAt" = LEAST("firstQueuedAt", ${at}::timestamptz),
           "humanRequestedAt" = LEAST("humanRequestedAt", ${at}::timestamptz),
           "queueEnteredAt" = COALESCE("queueEnteredAt", ${at}::timestamptz)
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** Saída da fila SEM atribuição (devolvida à IA, reativada fora da fila): a espera é descartada, não concluída. */
export async function markLeftQueue(tx: Tx, conversationId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle" SET "queueEnteredAt" = NULL
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL AND "queueEnteredAt" IS NOT NULL`;
}

/** Atribuição a um funcionário: intervenção humana efetiva; conclui a espera em andamento, se houver. */
export async function markAssigned(tx: Tx, conversationId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle"
       SET "firstAssignedAt" = LEAST("firstAssignedAt", ${at}::timestamptz),
           "humanRequestedAt" = LEAST("humanRequestedAt", ${at}::timestamptz),
           "queueWaitMs" = "queueWaitMs" + CASE WHEN "queueEnteredAt" IS NULL THEN 0
             ELSE GREATEST(0, floor(extract(epoch FROM (${at}::timestamptz - "queueEnteredAt")) * 1000))::bigint END,
           "queueWaitCount" = "queueWaitCount" + CASE WHEN "queueEnteredAt" IS NULL THEN 0 ELSE 1 END,
           "queueEnteredAt" = NULL
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** A IA respondeu ao cliente (mensagem gravada na mesma transação). */
export async function markAiActivity(tx: Tx, conversationId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle" SET "aiFirstAt" = LEAST("aiFirstAt", ${at}::timestamptz)
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** A IA transferiu para atendimento humano (a entrada na fila é registrada à parte, por markQueued). */
export async function markAiHandoff(tx: Tx, conversationId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle"
       SET "aiFirstAt" = LEAST("aiFirstAt", ${at}::timestamptz), "aiHandoffCount" = "aiHandoffCount" + 1
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** Mensagem escrita por uma pessoa da equipe (nunca IA, aviso de fila ou mensagem do sistema). */
export async function markHumanReply(tx: Tx, conversationId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle" SET "firstHumanReplyAt" = LEAST("firstHumanReplyAt", ${at}::timestamptz)
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** Encerramento: fecha o ciclo aberto. Uma espera em andamento é descartada (não virou atendimento). */
export async function closeCycle(tx: Tx, conversationId: string, at: Date, reason: ConversationCloseReason): Promise<void> {
  await tx.$executeRaw`
    UPDATE "ConversationCycle"
       SET "closedAt" = ${at}::timestamptz, "closeReason" = ${reason}::"ConversationCloseReason", "queueEnteredAt" = NULL
     WHERE "conversationId" = ${conversationId}::uuid AND "closedAt" IS NULL`;
}

/** Ciclo aberto da conversa (vínculo das execuções da IA). */
export async function openCycleId(tx: Tx, conversationId: string): Promise<string | null> {
  const cycle = await tx.conversationCycle.findFirst({ where: { conversationId, closedAt: null }, select: { id: true } });
  return cycle?.id ?? null;
}
