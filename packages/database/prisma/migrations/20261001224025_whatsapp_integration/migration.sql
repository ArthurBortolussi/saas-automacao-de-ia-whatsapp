-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('INTERNAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED');

-- DropIndex
DROP INDEX "Conversation_contactId_idx";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "whatsappId" VARCHAR(20);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channel" "ConversationChannel" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "lastInboundAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3),
ADD COLUMN     "deliveryStatus" "MessageDeliveryStatus",
ADD COLUMN     "errorCode" VARCHAR(32),
ADD COLUMN     "errorMessage" VARCHAR(500),
ADD COLUMN     "externalId" VARCHAR(128),
ADD COLUMN     "externalType" VARCHAR(32),
ADD COLUMN     "failedAt" TIMESTAMPTZ(3),
ADD COLUMN     "nextSendAttemptAt" TIMESTAMPTZ(3),
ADD COLUMN     "readAt" TIMESTAMPTZ(3),
ADD COLUMN     "sendAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "wabaId" VARCHAR(32) NOT NULL,
    "phoneNumberId" VARCHAR(32) NOT NULL,
    "displayPhoneNumber" VARCHAR(32) NOT NULL,
    "verifiedName" VARCHAR(120),
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'PENDING',
    "accessTokenCiphertext" TEXT NOT NULL,
    "tokenUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(32),
    "lastErrorMessage" VARCHAR(500),
    "lastErrorAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppWebhookEvent" (
    "id" UUID NOT NULL,
    "payloadSha256" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "companyId" UUID,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastError" VARCHAR(500),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_companyId_key" ON "WhatsAppAccount"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumberId_key" ON "WhatsAppAccount"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppWebhookEvent_payloadSha256_key" ON "WhatsAppWebhookEvent"("payloadSha256");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_status_nextAttemptAt_idx" ON "WhatsAppWebhookEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_companyId_idx" ON "WhatsAppWebhookEvent"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_whatsappId_key" ON "Contact"("companyId", "whatsappId");

-- CreateIndex
CREATE INDEX "Conversation_contactId_channel_idx" ON "Conversation"("contactId", "channel");

-- CreateIndex
CREATE INDEX "Message_deliveryStatus_nextSendAttemptAt_idx" ON "Message"("deliveryStatus", "nextSendAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_companyId_externalId_key" ON "Message"("companyId", "externalId");

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppWebhookEvent" ADD CONSTRAINT "WhatsAppWebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Regras de integridade que o schema Prisma não expressa (adicionadas à mão).
-- Status de entrega só existe para mensagens enviadas.
ALTER TABLE "Message" ADD CONSTRAINT "Message_deliveryStatus_outbound_check" CHECK ("deliveryStatus" IS NULL OR "direction" = 'OUTBOUND');
ALTER TABLE "Message" ADD CONSTRAINT "Message_sendAttempts_check" CHECK ("sendAttempts" >= 0);
ALTER TABLE "WhatsAppWebhookEvent" ADD CONSTRAINT "WhatsAppWebhookEvent_attempts_check" CHECK ("attempts" >= 0);
