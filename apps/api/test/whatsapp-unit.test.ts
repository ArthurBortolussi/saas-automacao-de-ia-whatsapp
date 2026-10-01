import { describe, expect, it } from "vitest";
import { buildWhatsAppConfig, whatsappEnvSchema } from "../src/config/whatsapp-config.js";
import { phoneVariants } from "../src/whatsapp/phone-variants.js";
import { TokenCipher } from "@arthur-ai/database/token-cipher";
import { isValidSignature, signPayload } from "../src/whatsapp/webhook-signature.js";
import { classifyMetaError } from "../src/whatsapp/whatsapp-errors.js";

describe("TokenCipher", () => {
  const cipher = new TokenCipher(Buffer.alloc(32, 1));

  it("cifra com IV aleatório e decifra com o mesmo AAD", () => {
    const a = cipher.encrypt("segredo", "empresa-1");
    const b = cipher.encrypt("segredo", "empresa-1");
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a, "empresa-1")).toBe("segredo");
  });

  it("falha com AAD diferente, chave diferente ou dado adulterado", () => {
    const payload = cipher.encrypt("segredo", "empresa-1");
    expect(() => cipher.decrypt(payload, "empresa-2")).toThrow();
    expect(() => new TokenCipher(Buffer.alloc(32, 2)).decrypt(payload, "empresa-1")).toThrow();
    const parts = payload.split(".");
    parts[3] = Buffer.from("adulterado").toString("base64url");
    expect(() => cipher.decrypt(parts.join("."), "empresa-1")).toThrow();
  });
});

describe("Assinatura X-Hub-Signature-256", () => {
  it("aceita só a assinatura correta do corpo bruto", () => {
    const body = Buffer.from('{"a":1}');
    expect(isValidSignature(body, signPayload(body, "segredo-1234567890"), "segredo-1234567890")).toBe(true);
    expect(isValidSignature(body, signPayload(body, "outro-1234567890"), "segredo-1234567890")).toBe(false);
    expect(isValidSignature(Buffer.from('{"a": 1}'), signPayload(body, "segredo-1234567890"), "segredo-1234567890")).toBe(false);
    expect(isValidSignature(body, undefined, "segredo-1234567890")).toBe(false);
    expect(isValidSignature(body, "sha1=abc", "segredo-1234567890")).toBe(false);
  });
});

describe("Variantes do 9º dígito", () => {
  it("gera as duas formas para celular brasileiro e nada a mais para outros", () => {
    expect(phoneVariants("551188887777")).toEqual(["551188887777", "5511988887777"]);
    expect(phoneVariants("5511988887777")).toEqual(["5511988887777", "551188887777"]);
    expect(phoneVariants("551133334444")).toEqual(["551133334444"]); // fixo
    expect(phoneVariants("14155552671")).toEqual(["14155552671"]);
  });
});

describe("Classificação de erros da Meta", () => {
  it.each([
    [190, 401, "auth", false],
    [131047, 400, "window", false],
    [130429, 429, "rate_limit", true],
    [131000, 500, "temporary", true],
    [131026, 400, "recipient", false],
    [100, 400, "permanent", false],
    [undefined, 503, "temporary", true],
  ] as const)("código %s / HTTP %s → %s", (code, status, kind, retryable) => {
    const error = classifyMetaError(code, status);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });
});

describe("Configuração por variáveis de ambiente", () => {
  const parse = (env: Record<string, string>, nodeEnv = "development") => buildWhatsAppConfig(whatsappEnvSchema.parse(env), nodeEnv);
  const full = {
    WHATSAPP_APP_SECRET: "a".repeat(32),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "b".repeat(32),
    WHATSAPP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  };

  it("sem variáveis: desabilitado e sem erro (o sistema sobe)", () => {
    const { config, errors } = parse({});
    expect(config.enabled).toBe(false);
    expect(errors).toEqual([]);
    expect(config.graphApiVersion).toBe("v25.0");
  });

  it("configuração parcial é erro de boot", () => {
    expect(parse({ WHATSAPP_APP_SECRET: "a".repeat(32) }).errors).toHaveLength(1);
  });

  it("produção recusa Graph API simulada e valores do .env.example", () => {
    expect(parse({ ...full, WHATSAPP_GRAPH_API_BASE_URL: "http://localhost:4010" }, "production").errors).toHaveLength(1);
    expect(parse({ ...full, WHATSAPP_APP_SECRET: "dev-fake-NAO-USAR-EM-PRODUCAO-123" }, "production").errors).toHaveLength(1);
    expect(parse(full, "production").errors).toEqual([]);
  });
});
