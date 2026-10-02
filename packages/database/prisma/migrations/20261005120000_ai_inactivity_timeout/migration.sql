-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "inactivityTimeoutMinutes" INTEGER NOT NULL DEFAULT 240;


-- ---------------------------------------------------------------- Regras extras (escrito à mão)
-- Mesmos limites do prazo da equipe (5 minutos a 30 dias). Linhas existentes recebem o padrão de 4 horas.
ALTER TABLE "AiSettings"
  ADD CONSTRAINT "AiSettings_inactivity_timeout_range" CHECK ("inactivityTimeoutMinutes" BETWEEN 5 AND 43200);
