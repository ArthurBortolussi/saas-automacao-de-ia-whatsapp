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
  return testUrl;
}
