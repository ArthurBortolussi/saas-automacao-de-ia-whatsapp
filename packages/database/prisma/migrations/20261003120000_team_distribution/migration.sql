-- CreateEnum
CREATE TYPE "AgentAvailability" AS ENUM ('AVAILABLE', 'BUSY', 'AWAY');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'QUEUED', 'ASSIGNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationCloseReason" AS ENUM ('MANUAL', 'INACTIVITY');

-- CreateEnum
CREATE TYPE "AssignmentStartReason" AS ENUM ('AUTO', 'TRANSFER', 'ASSUME', 'CREATED');

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('TRANSFERRED', 'CLOSED', 'RETURNED_TO_AI', 'REQUEUED');

-- AlterTable
ALTER TABLE "CompanyMember" ADD COLUMN     "availability" "AgentAvailability" NOT NULL DEFAULT 'AWAY',
ADD COLUMN     "availabilityChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "canAttend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastAssignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "maxConcurrent" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "closeReason" "ConversationCloseReason",
ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "closedByUserId" UUID,
ADD COLUMN     "cycleStartedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastActivityAt" TIMESTAMPTZ(3),
ADD COLUMN     "queueNoticeAt" TIMESTAMPTZ(3),
ADD COLUMN     "queueNoticeError" VARCHAR(40),
ADD COLUMN     "queuedAt" TIMESTAMPTZ(3),
ADD COLUMN     "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "ConversationAssignment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startReason" "AssignmentStartReason" NOT NULL,
    "actorUserId" UUID,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" "AssignmentEndReason",

    CONSTRAINT "ConversationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSettings" (
    "companyId" UUID NOT NULL,
    "inactivityTimeoutMinutes" INTEGER NOT NULL DEFAULT 240,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeamSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "ConversationAssignment_conversationId_assignedAt_idx" ON "ConversationAssignment"("conversationId", "assignedAt");

-- CreateIndex
CREATE INDEX "ConversationAssignment_companyId_userId_assignedAt_idx" ON "ConversationAssignment"("companyId", "userId", "assignedAt");

-- CreateIndex
CREATE INDEX "Conversation_companyId_status_queuedAt_idx" ON "Conversation"("companyId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "Conversation_companyId_assignedUserId_status_idx" ON "Conversation"("companyId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "Conversation_status_lastActivityAt_idx" ON "Conversation"("status", "lastActivityAt");

-- ---------------------------------------------------------------- Dados das fases anteriores (escrito à mão)
-- Estratégia explícita para conversas existentes. Nenhuma conversa é apagada e nenhuma recebe um responsável novo.
-- 1) Ciclo atual e última atividade a partir do que já existe.
UPDATE "Conversation" SET "cycleStartedAt" = "createdAt", "lastActivityAt" = COALESCE("lastMessageAt", "createdAt");

-- 2) Responsável que não é membro da empresa (ex.: SUPERADMIN que assumiu pela API) ou em conversa no modo IA:
--    a regra nova não permite; a conversa fica sem responsável (o histórico de mensagens não muda).
UPDATE "Conversation" c SET "assignedUserId" = NULL
 WHERE c."assignedUserId" IS NOT NULL
   AND (c."mode" = 'AI'
        OR NOT EXISTS (SELECT 1 FROM "CompanyMember" m WHERE m."companyId" = c."companyId" AND m."userId" = c."assignedUserId"));

-- 3) Humana/pausada COM responsável (quem clicou em "Assumir" na Fase 2): vira ASSIGNED para essa mesma pessoa.
UPDATE "Conversation" SET "status" = 'ASSIGNED', "assignedAt" = "updatedAt"
 WHERE "assignedUserId" IS NOT NULL AND "mode" IN ('HUMAN', 'PAUSED');
INSERT INTO "ConversationAssignment" ("id", "companyId", "conversationId", "userId", "startReason", "assignedAt")
SELECT gen_random_uuid(), "companyId", "id", "assignedUserId", 'ASSUME', "updatedAt"
  FROM "Conversation" WHERE "status" = 'ASSIGNED';

-- 4) Humana SEM responsável fica OPEN ("sem responsável" na Inbox): não entra na fila nem recebe aviso automático,
--    para não mandar mensagem de espera a clientes antigos. OWNER/ADMIN atribuem manualmente (Transferir).

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedMember_fkey" FOREIGN KEY ("companyId", "assignedUserId") REFERENCES "CompanyMember"("companyId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_conversationId_companyId_fkey" FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSettings" ADD CONSTRAINT "TeamSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- CHECKs (escritos à mão)
-- Impedem estados contraditórios entre modo, estado operacional, fila e responsável.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_status_consistency_check" CHECK (
  ("status" <> 'ASSIGNED' OR ("assignedUserId" IS NOT NULL AND "assignedAt" IS NOT NULL))
  AND ("status" = 'ASSIGNED' OR "assignedUserId" IS NULL)
  AND (("status" = 'QUEUED') = ("queuedAt" IS NOT NULL))
  AND ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL)
  -- Atendimento humano (na fila ou com responsável) nunca está no modo IA.
  AND ("mode" <> 'AI' OR "status" IN ('OPEN', 'CLOSED'))
);
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_maxConcurrent_check" CHECK ("maxConcurrent" BETWEEN 1 AND 100);
ALTER TABLE "TeamSettings" ADD CONSTRAINT "TeamSettings_inactivity_check" CHECK ("inactivityTimeoutMinutes" BETWEEN 5 AND 43200);
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_end_check"
  CHECK (("endedAt" IS NULL) = ("endReason" IS NULL));
