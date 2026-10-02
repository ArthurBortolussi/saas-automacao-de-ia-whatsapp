-- CreateEnum
CREATE TYPE "AiTone" AS ENUM ('FORMAL', 'PROFESSIONAL', 'FRIENDLY');

-- CreateEnum
CREATE TYPE "AiHandoffReason" AS ENUM ('CUSTOMER_REQUEST', 'MISSING_INFORMATION', 'MODEL_REFUSAL', 'INCOMPLETE_RESPONSE', 'AI_ERROR', 'UNSUPPORTED_CONTENT', 'CONVERSATION_LIMIT');

-- CreateEnum
CREATE TYPE "AiTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiRunResult" AS ENUM ('REPLIED', 'HANDOFF', 'DISCARDED', 'ERROR');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "aiHandoffAt" TIMESTAMPTZ(3),
ADD COLUMN     "aiHandoffReason" "AiHandoffReason";

-- CreateTable
CREATE TABLE "AiSettings" (
    "companyId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultConversationMode" "ConversationMode" NOT NULL DEFAULT 'AI',
    "assistantName" VARCHAR(60) NOT NULL DEFAULT 'Assistente',
    "tone" "AiTone" NOT NULL DEFAULT 'PROFESSIONAL',
    "instructions" VARCHAR(4000),
    "handoffMessage" VARCHAR(1000),
    "alwaysOn" BOOLEAN NOT NULL DEFAULT true,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "scheduleDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "scheduleStart" CHAR(5) NOT NULL DEFAULT '08:00',
    "scheduleEnd" CHAR(5) NOT NULL DEFAULT '18:00',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "content" VARCHAR(10000) NOT NULL,
    "category" VARCHAR(60),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReplyTask" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'PENDING',
    "runId" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "outcome" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiReplyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "result" "AiRunResult" NOT NULL,
    "stopReason" VARCHAR(40),
    "handoffReason" "AiHandoffReason",
    "errorType" VARCHAR(60),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "cacheReadInputTokens" INTEGER,
    "costUsd" DECIMAL(12,6),
    "latencyMs" INTEGER,
    "messageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeEntry_companyId_active_position_idx" ON "KnowledgeEntry"("companyId", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_id_companyId_key" ON "KnowledgeEntry"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AiReplyTask_messageId_key" ON "AiReplyTask"("messageId");

-- CreateIndex
CREATE INDEX "AiReplyTask_status_nextAttemptAt_idx" ON "AiReplyTask"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiReplyTask_conversationId_status_idx" ON "AiReplyTask"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AiReplyTask_runId_idx" ON "AiReplyTask"("runId");

-- CreateIndex
CREATE INDEX "AiRun_companyId_createdAt_idx" ON "AiRun"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_conversationId_idx" ON "AiRun"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_id_companyId_key" ON "Message"("id", "companyId");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReplyTask" ADD CONSTRAINT "AiReplyTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReplyTask" ADD CONSTRAINT "AiReplyTask_conversationId_companyId_fkey" FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReplyTask" ADD CONSTRAINT "AiReplyTask_messageId_companyId_fkey" FOREIGN KEY ("messageId", "companyId") REFERENCES "Message"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_conversationId_companyId_fkey" FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs escritos à mão (o Prisma não os expressa). Defesa em profundidade além do Zod.
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_schedule_time_check"
  CHECK ("scheduleStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "scheduleEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_schedule_days_check"
  CHECK ("scheduleDays" IS NOT NULL AND "scheduleDays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_position_check" CHECK ("position" >= 0);
ALTER TABLE "AiReplyTask" ADD CONSTRAINT "AiReplyTask_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_tokens_check" CHECK (
  coalesce("inputTokens", 0) >= 0 AND coalesce("outputTokens", 0) >= 0
  AND coalesce("cacheCreationInputTokens", 0) >= 0 AND coalesce("cacheReadInputTokens", 0) >= 0
  AND coalesce("costUsd", 0) >= 0 AND "messageCount" >= 1);
