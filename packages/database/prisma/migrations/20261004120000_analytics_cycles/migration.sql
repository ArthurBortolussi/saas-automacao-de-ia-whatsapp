-- CreateEnum
CREATE TYPE "AiApiSource" AS ENUM ('OFFICIAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "CycleOrigin" AS ENUM ('NEW_CONVERSATION', 'REOPENED', 'BACKFILL');

-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN     "apiSource" "AiApiSource",
ADD COLUMN     "cycleId" UUID;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo';

-- CreateTable
CREATE TABLE "ConversationCycle" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "origin" "CycleOrigin" NOT NULL,
    "startMode" "ConversationMode",
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "aiFirstAt" TIMESTAMPTZ(3),
    "aiHandoffCount" INTEGER NOT NULL DEFAULT 0,
    "humanRequestedAt" TIMESTAMPTZ(3),
    "firstQueuedAt" TIMESTAMPTZ(3),
    "queueEnteredAt" TIMESTAMPTZ(3),
    "queueWaitMs" BIGINT NOT NULL DEFAULT 0,
    "queueWaitCount" INTEGER NOT NULL DEFAULT 0,
    "firstAssignedAt" TIMESTAMPTZ(3),
    "firstHumanReplyAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "closeReason" "ConversationCloseReason",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationCycle_companyId_startedAt_idx" ON "ConversationCycle"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "ConversationCycle_companyId_closedAt_idx" ON "ConversationCycle"("companyId", "closedAt");

-- CreateIndex
CREATE INDEX "ConversationCycle_conversationId_startedAt_idx" ON "ConversationCycle"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "ConversationCycle_startedAt_idx" ON "ConversationCycle"("startedAt");

-- CreateIndex
CREATE INDEX "ConversationCycle_closedAt_idx" ON "ConversationCycle"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationCycle_id_companyId_key" ON "ConversationCycle"("id", "companyId");

-- CreateIndex
CREATE INDEX "AiRun_createdAt_idx" ON "AiRun"("createdAt");

-- CreateIndex
CREATE INDEX "AiRun_cycleId_idx" ON "AiRun"("cycleId");

-- CreateIndex
CREATE INDEX "Message_companyId_createdAt_idx" ON "Message"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_cycle_fkey" FOREIGN KEY ("cycleId", "companyId") REFERENCES "ConversationCycle"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationCycle" ADD CONSTRAINT "ConversationCycle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationCycle" ADD CONSTRAINT "ConversationCycle_conversationId_companyId_fkey" FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- Regras extras (escrito à mão)
-- No máximo UM ciclo aberto por conversa.
CREATE UNIQUE INDEX "ConversationCycle_one_open_per_conversation" ON "ConversationCycle"("conversationId") WHERE "closedAt" IS NULL;

ALTER TABLE "ConversationCycle"
  ADD CONSTRAINT "ConversationCycle_close_consistency" CHECK (("closedAt" IS NULL) = ("closeReason" IS NULL)),
  ADD CONSTRAINT "ConversationCycle_counters_non_negative" CHECK ("queueWaitMs" >= 0 AND "queueWaitCount" >= 0 AND "aiHandoffCount" >= 0),
  ADD CONSTRAINT "ConversationCycle_closed_without_wait" CHECK ("closedAt" IS NULL OR "queueEnteredAt" IS NULL),
  ADD CONSTRAINT "ConversationCycle_start_mode_known" CHECK ("origin" = 'BACKFILL' OR "startMode" IS NOT NULL);

-- ---------------------------------------------------------------- Dados das fases anteriores (escrito à mão)
-- Só o ciclo ATUAL de cada conversa existe nos dados (ciclos anteriores de conversas reabertas não foram
-- registrados e não são inventados). Cada conversa recebe um ciclo BACKFILL apenas com fatos verificáveis:
-- início, encerramento, espera em andamento, primeira resposta da IA/atribuição/mensagem de funcionário dentro
-- do ciclo. "humanRequestedAt" fica nulo: sem ele, tempo de primeira resposta e de espera concluída desses
-- ciclos não entram nas médias (não há como saber quando o atendimento humano foi pedido).
INSERT INTO "ConversationCycle" ("id", "companyId", "conversationId", "origin", "startMode", "startedAt",
                                 "closedAt", "closeReason", "firstQueuedAt", "queueEnteredAt", "aiHandoffCount")
SELECT gen_random_uuid(), c."companyId", c."id", 'BACKFILL', NULL,
       COALESCE(c."cycleStartedAt", c."createdAt"),
       CASE WHEN c."status" = 'CLOSED' THEN COALESCE(c."closedAt", c."updatedAt") END,
       CASE WHEN c."status" = 'CLOSED' THEN COALESCE(c."closeReason", 'MANUAL') END,
       CASE WHEN c."status" = 'QUEUED' THEN c."queuedAt" END,
       CASE WHEN c."status" = 'QUEUED' THEN c."queuedAt" END,
       CASE WHEN c."aiHandoffAt" IS NOT NULL AND c."aiHandoffAt" >= COALESCE(c."cycleStartedAt", c."createdAt") THEN 1 ELSE 0 END
  FROM "Conversation" c;

UPDATE "ConversationCycle" y SET
  "aiFirstAt" = (
    SELECT LEAST(
      (SELECT min(m."createdAt") FROM "Message" m
        WHERE m."conversationId" = y."conversationId" AND m."senderType" = 'AI'
          AND m."createdAt" >= y."startedAt" AND (y."closedAt" IS NULL OR m."createdAt" <= y."closedAt")),
      (SELECT c."aiHandoffAt" FROM "Conversation" c
        WHERE c."id" = y."conversationId" AND c."aiHandoffAt" >= y."startedAt"))),
  "firstAssignedAt" = (
    SELECT min(a."assignedAt") FROM "ConversationAssignment" a
     WHERE a."conversationId" = y."conversationId"
       AND a."assignedAt" >= y."startedAt" AND (y."closedAt" IS NULL OR a."assignedAt" <= y."closedAt")),
  "firstHumanReplyAt" = (
    SELECT min(m."createdAt") FROM "Message" m
     WHERE m."conversationId" = y."conversationId" AND m."senderType" = 'AGENT'
       AND m."createdAt" >= y."startedAt" AND (y."closedAt" IS NULL OR m."createdAt" <= y."closedAt"))
 WHERE y."origin" = 'BACKFILL';

-- Execuções da IA dentro do ciclo atual (mesma conversa, a partir do início do ciclo). A origem (oficial ou
-- simulada) dos registros antigos NÃO é deduzida: "apiSource" continua nulo = origem não verificada.
UPDATE "AiRun" r SET "cycleId" = y."id"
  FROM "ConversationCycle" y
 WHERE y."conversationId" = r."conversationId" AND y."origin" = 'BACKFILL' AND r."createdAt" >= y."startedAt";
