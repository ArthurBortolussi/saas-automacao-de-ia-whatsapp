import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Carrega o .env da raiz e aponta DATABASE_URL para o banco de TESTE. */
export function useTestDatabaseEnv(): string {
  const rootEnv = resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const testUrl = process.env["TEST_DATABASE_URL"];
  if (!testUrl) throw new Error("TEST_DATABASE_URL não definida (veja .env.example).");
  // Proteção: os testes truncam tabelas. Só aceita bancos cujo nome termina em "_test".
  if (!new URL(testUrl).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco cujo nome termina em _test.");
  }
  process.env["DATABASE_URL"] = testUrl;
  process.env["NODE_ENV"] = "test";
  // Sem timer do worker do WhatsApp nos testes: quem precisa processa a fila com worker.drain().
  process.env["WHATSAPP_WORKER_INTERVAL_MS"] = "0";
  // IA: os testes não herdam nada do .env do desenvolvedor (vazio = padrão do código; vazio, e não removido,
  // para o .env não repor o valor). Sem chave, a IA fica "não configurada" e nenhum teste chama a Anthropic real.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_") || key.startsWith("ANTHROPIC_")) process.env[key] = "";
  }
  process.env["ANTHROPIC_API_KEY"] = "";
  process.env["ANTHROPIC_BASE_URL"] = "";
  process.env["AI_WORKER_INTERVAL_MS"] = "0";
  return testUrl;
}
