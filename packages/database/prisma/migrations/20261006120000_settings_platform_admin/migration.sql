-- CreateEnum
CREATE TYPE "SettingsPermission" AS ENUM ('AI', 'SERVICE', 'SCHEDULE', 'MESSAGES');

-- CreateEnum
CREATE TYPE "ScheduleOverride" AS ENUM ('DEFAULT', 'CLOSED', 'CUSTOM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiHandoffReason" ADD VALUE 'AI_PAUSED';
ALTER TYPE "AiHandoffReason" ADD VALUE 'AI_LIMIT_REACHED';

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "monthlyLimitUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "monthlyLimitUsd" DECIMAL(12,2),
ADD COLUMN     "pausedAt" TIMESTAMPTZ(3),
ADD COLUMN     "pausedByUserId" UUID;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "reactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "statusBeforeSuspension" "CompanyStatus",
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CompanyMember" ADD COLUMN     "settingsPermissions" "SettingsPermission"[] DEFAULT ARRAY[]::"SettingsPermission"[];

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "welcomeHandledAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "afterHoursNoticeKey" VARCHAR(40);

-- AlterTable
ALTER TABLE "TeamSettings" ADD COLUMN     "maxQueueWaitMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "teamAlwaysOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "teamDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "teamEnd" CHAR(5) NOT NULL DEFAULT '18:00',
ADD COLUMN     "teamStart" CHAR(5) NOT NULL DEFAULT '08:00';

-- AlterTable
ALTER TABLE "WhatsAppWebhookEvent" ADD COLUMN     "ignoredReason" VARCHAR(40);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "companyId" UUID NOT NULL,
    "businessAlwaysOpen" BOOLEAN NOT NULL DEFAULT false,
    "businessDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "businessStart" CHAR(5) NOT NULL DEFAULT '08:00',
    "businessEnd" CHAR(5) NOT NULL DEFAULT '18:00',
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeMessage" VARCHAR(1000),
    "queueNoticeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "queueNoticeMessage" VARCHAR(1000),
    "afterHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "afterHoursMessage" VARCHAR(1000),
    "closingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "closingMessage" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "businessMode" "ScheduleOverride" NOT NULL DEFAULT 'DEFAULT',
    "businessStart" CHAR(5),
    "businessEnd" CHAR(5),
    "aiMode" "ScheduleOverride" NOT NULL DEFAULT 'DEFAULT',
    "aiStart" CHAR(5),
    "aiEnd" CHAR(5),
    "teamMode" "ScheduleOverride" NOT NULL DEFAULT 'DEFAULT',
    "teamStart" CHAR(5),
    "teamEnd" CHAR(5),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "supportEmail" VARCHAR(254),
    "supportWhatsapp" VARCHAR(15),
    "defaultAiMonthlyLimitUsd" DECIMAL(12,2),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLogo" (
    "companyId" UUID NOT NULL,
    "contentType" VARCHAR(32) NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyLogo_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "AiBudgetReservation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "apiSource" "AiApiSource" NOT NULL,
    "amountUsd" DECIMAL(12,6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageAlert" (
    "companyId" UUID NOT NULL,
    "month" CHAR(7) NOT NULL,
    "apiSource" "AiApiSource" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "reachedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageAlert_pkey" PRIMARY KEY ("companyId","month","apiSource","threshold")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleException_companyId_date_key" ON "ScheduleException"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleException_id_companyId_key" ON "ScheduleException"("id", "companyId");

-- CreateIndex
CREATE INDEX "AiBudgetReservation_companyId_expiresAt_idx" ON "AiBudgetReservation"("companyId", "expiresAt");

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLogo" ADD CONSTRAINT "CompanyLogo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageAlert" ADD CONSTRAINT "AiUsageAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------- Regras extras (escrito à mão)

-- Configuração global: uma única linha.
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_single_row" CHECK ("id" = 1);
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_default_limit_positive"
  CHECK ("defaultAiMonthlyLimitUsd" IS NULL OR "defaultAiMonthlyLimitUsd" > 0);
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_support_whatsapp_digits"
  CHECK ("supportWhatsapp" IS NULL OR "supportWhatsapp" ~ '^[0-9]{10,15}$');

ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_monthly_limit_positive"
  CHECK ("monthlyLimitUsd" IS NULL OR "monthlyLimitUsd" > 0);

-- Horários HH:MM e dias 0–6 (as mesmas regras do schema compartilhado).
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_business_hours_format"
  CHECK ("businessStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "businessEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         AND "businessDays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
ALTER TABLE "TeamSettings" ADD CONSTRAINT "TeamSettings_team_hours_format"
  CHECK ("teamStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "teamEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         AND "teamDays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
ALTER TABLE "TeamSettings" ADD CONSTRAINT "TeamSettings_max_queue_wait_range" CHECK ("maxQueueWaitMinutes" BETWEEN 1 AND 1440);

-- Exceção: horário especial exige início e término diferentes; os outros modos não guardam horário.
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_business_consistent" CHECK (
  ("businessMode" = 'CUSTOM' AND "businessStart" IS NOT NULL AND "businessEnd" IS NOT NULL AND "businessStart" <> "businessEnd")
  OR ("businessMode" <> 'CUSTOM' AND "businessStart" IS NULL AND "businessEnd" IS NULL));
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_ai_consistent" CHECK (
  ("aiMode" = 'CUSTOM' AND "aiStart" IS NOT NULL AND "aiEnd" IS NOT NULL AND "aiStart" <> "aiEnd")
  OR ("aiMode" <> 'CUSTOM' AND "aiStart" IS NULL AND "aiEnd" IS NULL));
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_team_consistent" CHECK (
  ("teamMode" = 'CUSTOM' AND "teamStart" IS NOT NULL AND "teamEnd" IS NOT NULL AND "teamStart" <> "teamEnd")
  OR ("teamMode" <> 'CUSTOM' AND "teamStart" IS NULL AND "teamEnd" IS NULL));

-- Logotipo: no máximo 512 KB e só os tipos aceitos pela API.
ALTER TABLE "CompanyLogo" ADD CONSTRAINT "CompanyLogo_size_limit" CHECK ("sizeBytes" BETWEEN 1 AND 524288 AND octet_length("data") = "sizeBytes");
ALTER TABLE "CompanyLogo" ADD CONSTRAINT "CompanyLogo_content_type" CHECK ("contentType" IN ('image/png', 'image/jpeg', 'image/webp'));

ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_amount_positive" CHECK ("amountUsd" >= 0);
ALTER TABLE "AiUsageAlert" ADD CONSTRAINT "AiUsageAlert_threshold" CHECK ("threshold" IN (80, 100));
ALTER TABLE "AiUsageAlert" ADD CONSTRAINT "AiUsageAlert_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Suspensão: suspensa ⇔ data da suspensão registrada (e status PAUSED).
ALTER TABLE "Company" ADD CONSTRAINT "Company_suspension_consistent"
  CHECK ("suspendedAt" IS NULL OR "status" = 'PAUSED');

-- ---------------------------------------------------------------- Dados existentes (preservação)

-- Administradores existentes já editavam a IA e o atendimento (Fases 4 e 5): recebem todos os grupos, para que a
-- migração não retire acessos. Membros cadastrados a partir de agora começam sem concessões (o OWNER decide).
UPDATE "CompanyMember" SET "settingsPermissions" = ARRAY['AI', 'SERVICE', 'SCHEDULE', 'MESSAGES']::"SettingsPermission"[]
 WHERE "role" = 'ADMIN';

-- Clientes que já escreveram antes desta fase não recebem boas-vindas ("primeiro contato" já aconteceu).
UPDATE "Contact" c SET "welcomeHandledAt" = sub."firstAt"
  FROM (SELECT "conversationId", min(m."createdAt") AS "firstAt" FROM "Message" m WHERE m."direction" = 'INBOUND' GROUP BY 1) AS sub
  JOIN "Conversation" v ON v."id" = sub."conversationId"
 WHERE v."contactId" = c."id" AND c."welcomeHandledAt" IS NULL;

-- Fuso único da empresa: o horário da IA passa a usar Company.timezone. Empresas que tinham escolhido outro fuso
-- para a IA mantêm o mesmo comportamento (Company.timezone não tinha tela até aqui; ver README).
UPDATE "Company" co SET "timezone" = s."timezone"
  FROM "AiSettings" s
 WHERE s."companyId" = co."id" AND s."timezone" <> co."timezone";
