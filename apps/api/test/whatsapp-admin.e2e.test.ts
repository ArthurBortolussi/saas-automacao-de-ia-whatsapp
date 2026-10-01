import type { Company } from "@arthur-ai/database";
import type { ApiError, WhatsAppAdminResponse, WhatsAppCompanyStatus } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TokenCipher } from "@arthur-ai/database/token-cipher";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { createCompany, createMember, createTestApp, createUser, login, ORIGIN, resetDatabase, type TestContext } from "./helpers.js";
import { enableWhatsAppEnv, metaError, MockGraphApi, TEST_ENCRYPTION_KEY } from "./whatsapp-helpers.js";

const TOKEN = "EAAG-token-ficticio-super-secreto-0123456789";
const configWithoutToken = { wabaId: "100000000000001", phoneNumberId: "111111111111111", displayPhoneNumber: "+55 11 4000-0001" };
const config = { wabaId: "100000000000001", phoneNumberId: "111111111111111", displayPhoneNumber: "+55 11 4000-0001", accessToken: TOKEN };

describe("Configuração do WhatsApp pelo SUPERADMIN", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let restoreEnv: () => void;
  let adminCookie: string;
  let ownerCookie: string;
  let company: Company;
  let other: Company;

  const path = (target: Company) => `/api/admin/companies/${target.id}/whatsapp`;
  const put = (target: Company, cookie: string, body: object) => ctx.http.put(path(target)).set("Origin", ORIGIN).set("Cookie", cookie).send(body);
  const action = (target: Company, cookie: string, value: string) =>
    ctx.http.post(`${path(target)}/actions`).set("Origin", ORIGIN).set("Cookie", cookie).send({ action: value });

  beforeAll(async () => {
    graph = new MockGraphApi();
    await graph.start();
    restoreEnv = enableWhatsAppEnv(graph.url);
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.app.get(WhatsAppWorker).drain();
    await resetDatabase(ctx.prisma);
    graph.reset();
    company = await createCompany(ctx.prisma, { name: "Cliente" });
    other = await createCompany(ctx.prisma, { name: "Outra" });
    adminCookie = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
    ownerCookie = await login(ctx.http, (await createMember(ctx.prisma, company.id, { role: "OWNER" })).email);
  });

  afterAll(async () => {
    await ctx.app.close();
    await graph.stop();
    restoreEnv();
  });

  it("cadastra: token cifrado no banco, nunca devolvido nem auditado", async () => {
    const response = await put(company, adminCookie, config);
    expect(response.status).toBe(200);
    const body = response.body as WhatsAppAdminResponse;
    expect(body.account).toMatchObject({ phoneNumberId: config.phoneNumberId, status: "PENDING", hasAccessToken: true });
    expect(body.platform).toMatchObject({ enabled: true, simulated: true, graphApiVersion: "v25.0", webhookPath: "/api/webhooks/whatsapp" });
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const row = await ctx.prisma.whatsAppAccount.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(row.accessTokenCiphertext).not.toContain(TOKEN);
    expect(row.accessTokenCiphertext).toMatch(/^v1\./);
    expect(new TokenCipher(Buffer.from(TEST_ENCRYPTION_KEY, "base64")).decrypt(row.accessTokenCiphertext, company.id)).toBe(TOKEN);

    const audit = await ctx.prisma.auditLog.findMany({ where: { companyId: company.id } });
    expect(audit.map((a) => a.action)).toContain("whatsapp.account_created");
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect(JSON.stringify(await ctx.http.get(path(company)).set("Cookie", adminCookie).then((r) => r.body as unknown))).not.toContain(TOKEN);
  });

  it("ciphertext copiado para outra empresa não decifra (companyId como dado autenticado)", async () => {
    await put(company, adminCookie, config);
    const row = await ctx.prisma.whatsAppAccount.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(() => new TokenCipher(Buffer.from(TEST_ENCRYPTION_KEY, "base64")).decrypt(row.accessTokenCiphertext, other.id)).toThrow();
  });

  it("atualiza sem reenviar o token: o token anterior é mantido", async () => {
    await put(company, adminCookie, config);
    const before = await ctx.prisma.whatsAppAccount.findUniqueOrThrow({ where: { companyId: company.id } });
    const response = await put(company, adminCookie, { ...configWithoutToken, displayPhoneNumber: "+55 11 4000-0002", accessToken: "" });
    expect(response.status).toBe(200);
    const after = await ctx.prisma.whatsAppAccount.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(after.displayPhoneNumber).toBe("+55 11 4000-0002");
    expect(after.accessTokenCiphertext).toBe(before.accessTokenCiphertext);
  });

  it("primeiro cadastro sem token: 400; dados inválidos: 400", async () => {
    expect((await put(company, adminCookie, configWithoutToken)).status).toBe(400);
    expect((await put(company, adminCookie, { ...config, phoneNumberId: "abc" })).status).toBe(400);
    expect((await put(company, adminCookie, { ...config, accessToken: "curto" })).status).toBe(400);
    expect((await put(company, adminCookie, { ...config, status: "ACTIVE" })).status).toBe(400);
  });

  it("[#7] o mesmo Phone Number ID não pode ser ligado a duas empresas", async () => {
    await put(company, adminCookie, config);
    const response = await put(other, adminCookie, config);
    expect(response.status).toBe(409);
    expect((response.body as ApiError).message).toBe("Este Phone Number ID já está conectado a outra empresa.");
  });

  it("testar conexão: ACTIVE com resposta da Meta; ERROR com mensagem segura quando o token é recusado", async () => {
    await put(company, adminCookie, config);
    const ok = (await action(company, adminCookie, "TEST")).body as WhatsAppAdminResponse;
    expect(ok.account).toMatchObject({ status: "ACTIVE", verifiedName: "Empresa Teste", lastErrorMessage: null });
    expect(graph.requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(graph.requests[0]?.path).toContain(`/v25.0/${config.phoneNumberId}?fields=`);

    graph.respondWith(() => metaError(190, 401));
    const failed = (await action(company, adminCookie, "TEST")).body as WhatsAppAdminResponse;
    expect(failed.account).toMatchObject({ status: "ERROR", lastErrorCode: "190" });
    expect(failed.account?.lastErrorMessage).toContain("credenciais");
    expect(JSON.stringify(failed)).not.toContain("erro simulado");
  });

  it("desativar e reativar", async () => {
    await put(company, adminCookie, config);
    expect(((await action(company, adminCookie, "DISABLE")).body as WhatsAppAdminResponse).account?.status).toBe("DISABLED");
    expect((await action(company, adminCookie, "TEST")).status).toBe(409);
    expect(((await action(company, adminCookie, "ENABLE")).body as WhatsAppAdminResponse).account?.status).toBe("PENDING");
    const actions = (await ctx.prisma.auditLog.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["whatsapp.account_created", "whatsapp.account_disabled", "whatsapp.account_enabled"]);
  });

  it("[#8] funcionário da empresa: sem acesso à configuração técnica, só ao próprio status", async () => {
    await put(company, adminCookie, config);
    expect((await ctx.http.get(path(company)).set("Cookie", ownerCookie)).status).toBe(403);
    expect((await put(company, ownerCookie, config)).status).toBe(403);
    expect((await action(company, ownerCookie, "DISABLE")).status).toBe(403);

    const status = await ctx.http.get(`/api/companies/${company.id}/whatsapp`).set("Cookie", ownerCookie);
    expect(status.status).toBe(200);
    expect(status.body as WhatsAppCompanyStatus).toEqual({ connected: false, status: "PENDING", displayPhoneNumber: config.displayPhoneNumber, verifiedName: null });
    expect(JSON.stringify(status.body)).not.toMatch(/phoneNumberId|wabaId|token/i);

    expect((await ctx.http.get(`/api/companies/${other.id}/whatsapp`).set("Cookie", ownerCookie)).status).toBe(403);
  });
});

describe("Configuração com a integração desabilitada no servidor", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    for (const key of ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_TOKEN_ENCRYPTION_KEY"]) {
      Reflect.deleteProperty(process.env, key);
    }
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("mostra o estado (o que falta) e recusa salvar com 503", async () => {
    const company = await createCompany(ctx.prisma);
    const cookie = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
    const info = (await ctx.http.get(`/api/admin/companies/${company.id}/whatsapp`).set("Cookie", cookie)).body as WhatsAppAdminResponse;
    expect(info.platform.enabled).toBe(false);
    expect(info.platform.missing).toEqual(["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_TOKEN_ENCRYPTION_KEY"]);
    const response = await ctx.http.put(`/api/admin/companies/${company.id}/whatsapp`).set("Origin", ORIGIN).set("Cookie", cookie).send(config);
    expect(response.status).toBe(503);
  });
});
