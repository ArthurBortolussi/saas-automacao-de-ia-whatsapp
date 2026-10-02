import type { Prisma } from "@arthur-ai/database";

/**
 * Trava transacional por empresa para tudo o que mexe em atribuições (distribuição, transferência, encerramento,
 * disponibilidade, limites, devolução para a IA). Serializa essas operações da MESMA empresa — inclusive entre
 * várias instâncias da API — e assim nenhuma conversa é atribuída duas vezes e nenhum limite é ultrapassado.
 * Empresas diferentes não esperam umas pelas outras. Liberada automaticamente no fim da transação.
 */
export async function lockCompanyTeam(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`team:${companyId}`}, 0))`;
}
