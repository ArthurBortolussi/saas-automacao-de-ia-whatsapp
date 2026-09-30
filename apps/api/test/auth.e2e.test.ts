import type { ApiError, MeResponse } from "@arthur-ai/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, createUser, login, ORIGIN, PASSWORD, resetDatabase, type TestContext } from "./helpers.js";

describe("Autenticação e sessão", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("[#7] request sem sessão recebe 401", async () => {
    const response = await ctx.http.get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ statusCode: 401, error: "Unauthorized" });
  });

  it("[#7] cookie com token inexistente recebe 401", async () => {
    const response = await ctx.http.get("/api/auth/me").set("Cookie", `aai_session=${"a".repeat(43)}`);
    expect(response.status).toBe(401);
  });

  it("login válido cria sessão no banco guardando apenas o hash do token", async () => {
    const user = await createUser(ctx.prisma);
    const cookie = await login(ctx.http, user.email.toUpperCase());
    const token = cookie.split("=")[1] ?? "";

    const sessions = await ctx.prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]?.tokenHash).not.toBe(token);

    const me = await ctx.http.get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect((me.body as MeResponse).user).toMatchObject({ id: user.id, email: user.email, globalRole: "USER" });
    expect((me.body as MeResponse).user).not.toHaveProperty("passwordHash");
  });

  it("erro de login é genérico para e-mail inexistente e senha errada, e é auditado sem senha", async () => {
    const user = await createUser(ctx.prisma);
    const wrongPassword = await ctx.http
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: user.email, password: "senha-errada-123" });
    const unknownEmail = await ctx.http
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "ninguem@test.local", password: "senha-errada-123" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect((wrongPassword.body as ApiError).message).toBe("Credenciais inválidas.");
    expect((unknownEmail.body as ApiError).message).toBe((wrongPassword.body as ApiError).message);

    const failures = await ctx.prisma.auditLog.findMany({ where: { action: "auth.login_failed" } });
    const unknown = failures.find((log) => log.actorUserId === null);
    expect(unknown?.metadata).toMatchObject({ email: "ninguem@test.local", reason: "unknown_email" });
    expect(failures.find((log) => log.actorUserId === user.id)).toBeDefined();
    expect(JSON.stringify(failures)).not.toContain("senha-errada-123");
  });

  it("login bem-sucedido é auditado", async () => {
    const user = await createUser(ctx.prisma);
    await login(ctx.http, user.email);
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: "auth.login_succeeded", actorUserId: user.id } });
    expect(log).not.toBeNull();
  });

  it("[#8] após logout, o mesmo cookie recebe 401", async () => {
    const user = await createUser(ctx.prisma);
    const cookie = await login(ctx.http, user.email);

    const logout = await ctx.http.post("/api/auth/logout").set("Origin", ORIGIN).set("Cookie", cookie);
    expect(logout.status).toBe(204);
    expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(0);

    const after = await ctx.http.get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("[#9] usuário desativado com sessão válida recebe 401 no próximo request", async () => {
    const user = await createUser(ctx.prisma);
    const cookie = await login(ctx.http, user.email);
    expect((await ctx.http.get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);

    await ctx.prisma.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });

    const after = await ctx.http.get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("usuário INACTIVE não consegue logar (mensagem genérica)", async () => {
    const user = await createUser(ctx.prisma, { status: "INACTIVE" });
    const response = await ctx.http.post("/api/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(401);
    expect((response.body as ApiError).message).toBe("Credenciais inválidas.");
  });

  it("sessão expirada recebe 401 e é removida", async () => {
    const user = await createUser(ctx.prisma);
    const cookie = await login(ctx.http, user.email);
    await ctx.prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await ctx.http.get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  describe("[#11] troca obrigatória de senha", () => {
    it("bloqueia rotas fora de me/logout/change-password e libera após a troca, revogando outras sessões", async () => {
      const company = await ctx.prisma.company.create({
        data: { name: "Empresa MCP", slug: "empresa-mcp", industry: "Teste", phone: "11999999999", status: "ACTIVE" },
      });
      const user = await createUser(ctx.prisma, { mustChangePassword: true });
      await ctx.prisma.companyMember.create({ data: { companyId: company.id, userId: user.id, role: "OWNER" } });

      const otherSession = await login(ctx.http, user.email);
      const cookie = await login(ctx.http, user.email);

      const blocked = await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie);
      expect(blocked.status).toBe(403);
      expect((blocked.body as ApiError).code).toBe("PASSWORD_CHANGE_REQUIRED");

      const me = await ctx.http.get("/api/auth/me").set("Cookie", cookie);
      expect(me.status).toBe(200);
      expect((me.body as MeResponse).user.mustChangePassword).toBe(true);

      const weak = await ctx.http
        .post("/api/auth/change-password")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie)
        .send({ currentPassword: PASSWORD, newPassword: "curta" });
      expect(weak.status).toBe(400);

      const wrongCurrent = await ctx.http
        .post("/api/auth/change-password")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie)
        .send({ currentPassword: "senha-errada-123", newPassword: "nova-senha-segura-123" });
      expect(wrongCurrent.status).toBe(401);

      const changed = await ctx.http
        .post("/api/auth/change-password")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie)
        .send({ currentPassword: PASSWORD, newPassword: "nova-senha-segura-123" });
      expect(changed.status).toBe(204);

      expect((await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie)).status).toBe(200);
      expect((await ctx.http.get("/api/auth/me").set("Cookie", otherSession)).status).toBe(401);
      await login(ctx.http, user.email, "nova-senha-segura-123");
    });
  });

  describe("CSRF: checagem de Origin", () => {
    it("requisição mutável sem Origin ou com Origin estranho recebe 403", async () => {
      const user = await createUser(ctx.prisma);
      const cookie = await login(ctx.http, user.email);

      const missing = await ctx.http.post("/api/auth/logout").set("Cookie", cookie);
      expect(missing.status).toBe(403);
      const foreign = await ctx.http.post("/api/auth/logout").set("Cookie", cookie).set("Origin", "https://evil.example");
      expect(foreign.status).toBe(403);
      const loginForeign = await ctx.http
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({ email: user.email, password: PASSWORD });
      expect(loginForeign.status).toBe(403);

      // A sessão continua válida: nenhuma das requisições acima teve efeito.
      expect((await ctx.http.get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    });
  });
});

// Simula a produção com proxy de borda confiável: o supertest (loopback) faz o papel do proxy
// que define X-Forwarded-For, e a API confia em exatamente 1 hop.
describe("Rate limit de login (TRUST_PROXY=1, atrás de proxy confiável)", () => {
  let ctx: TestContext;
  const previous = process.env["TRUST_PROXY"];

  beforeAll(async () => {
    process.env["TRUST_PROXY"] = "1";
    ctx = await createTestApp({ windowMs: 60_000, maxAttemptsPerIp: 6, maxFailuresPerEmail: 3 });
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    process.env["TRUST_PROXY"] = previous;
  });

  const attempt = (email: string, password: string, ip: string) =>
    ctx.http.post("/api/auth/login").set("Origin", ORIGIN).set("X-Forwarded-For", ip).send({ email, password });

  it("bloqueia por e-mail após falhas consecutivas, inclusive com a senha correta", async () => {
    const user = await createUser(ctx.prisma);
    for (let i = 0; i < 3; i++) {
      expect((await attempt(user.email, "senha-errada-123", `10.0.0.${i + 1}`)).status).toBe(401);
    }
    const blocked = await attempt(user.email, PASSWORD, "10.0.0.50");
    expect(blocked.status).toBe(429);
  });

  it("bloqueia por IP independentemente do e-mail", async () => {
    for (let i = 0; i < 6; i++) {
      expect((await attempt(`x${i}@test.local`, "qualquer-senha-1", "10.9.9.9")).status).toBe(401);
    }
    expect((await attempt("outro@test.local", "qualquer-senha-1", "10.9.9.9")).status).toBe(429);
    // Outro IP continua liberado.
    expect((await attempt("outro@test.local", "qualquer-senha-1", "10.9.9.10")).status).toBe(401);
  });
});

describe("Rate limit com TRUST_PROXY=false", () => {
  let ctx: TestContext;
  const previous = process.env["TRUST_PROXY"];

  beforeAll(async () => {
    process.env["TRUST_PROXY"] = "false";
    ctx = await createTestApp({ windowMs: 60_000, maxAttemptsPerIp: 3, maxFailuresPerEmail: 100 });
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    process.env["TRUST_PROXY"] = previous;
  });

  it("ignora X-Forwarded-For forjado: trocar o header não escapa do limite por IP", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await ctx.http
        .post("/api/auth/login")
        .set("Origin", ORIGIN)
        .set("X-Forwarded-For", `203.0.113.${i}`)
        .send({ email: `y${i}@test.local`, password: "qualquer-senha-1" });
      expect(response.status).toBe(401);
    }
    const spoofed = await ctx.http
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-Forwarded-For", "203.0.113.99")
      .send({ email: "z@test.local", password: "qualquer-senha-1" });
    expect(spoofed.status).toBe(429);
  });
});

describe("Cookie de sessão com SESSION_COOKIE_SECURE=true", () => {
  let ctx: TestContext;
  const previous = process.env["SESSION_COOKIE_SECURE"];

  beforeAll(async () => {
    process.env["SESSION_COOKIE_SECURE"] = "true";
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    process.env["SESSION_COOKIE_SECURE"] = previous;
  });

  it("usa o prefixo __Host- com Secure, HttpOnly, SameSite=Lax e Path=/", async () => {
    const user = await createUser(ctx.prisma);
    const response = await ctx.http.post("/api/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    const cookie = (response.headers["set-cookie"] as unknown as string[])[0] ?? "";
    expect(cookie).toMatch(/^__Host-aai_session=/);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});
