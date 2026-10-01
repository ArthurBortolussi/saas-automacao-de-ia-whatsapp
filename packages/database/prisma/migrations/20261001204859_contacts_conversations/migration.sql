-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'LEAD', 'QUALIFIED', 'CUSTOMER', 'LOST');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('MANUAL', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'SOCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'HUMAN', 'PAUSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CONTACT', 'AGENT', 'AI', 'SYSTEM');

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(254),
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'AI',
    "modeBeforePause" "ConversationMode",
    "assignedUserId" UUID,
    "lastMessageAt" TIMESTAMPTZ(3),
    "lastMessagePreview" VARCHAR(160),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderUserId" UUID,
    "body" VARCHAR(4000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_companyId_createdAt_idx" ON "Contact"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_phone_key" ON "Contact"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_companyId_key" ON "Contact"("id", "companyId");

-- CreateIndex
CREATE INDEX "Conversation_companyId_lastMessageAt_idx" ON "Conversation"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_companyId_mode_idx" ON "Conversation"("companyId", "mode");

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_companyId_key" ON "Conversation"("id", "companyId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_companyId_fkey" FOREIGN KEY ("contactId", "companyId") REFERENCES "Contact"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_companyId_fkey" FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras de integridade que o schema Prisma não expressa (adicionadas à mão).
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_phone_digits_check" CHECK ("phone" ~ '^[0-9]{10,15}$');
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_unreadCount_check" CHECK ("unreadCount" >= 0);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_modeBeforePause_check" CHECK ("modeBeforePause" IS NULL OR "modeBeforePause" <> 'PAUSED');
ALTER TABLE "Message" ADD CONSTRAINT "Message_body_not_blank_check" CHECK (length(btrim("body")) > 0);
