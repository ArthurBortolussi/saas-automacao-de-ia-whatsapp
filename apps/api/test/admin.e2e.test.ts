import type { AdminDashboardResponse, ApiError, CompanyDetail, CompanySummary, Paginated } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCompany,
  createMember,
  createUser,
  login,
  ORIGIN,
  resetDatabase,
  createTestApp,
  type TestContext } from "./helpers.js";

const validCompany = {
  name: "Clínica São João",
  industry: "Saúde",
  phone: "(11) 3333-4444",
  cnpj: "11.222.333/0001-81",
  state: "SP",
  city: "São Paulo",
};

describe("Área SUPERADMIN", () => {
  let ctx: TestContext;
  let adminCookie: string;
  let userCookie: string;

  const post = (path: string, cookie: string, body: object) =>
    ctx.http.post(path).set("Origin", ORIGIN).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    const admin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    adminCookie = await login(ctx.http, admin.email);
    const company = await createCompany(ctx.prisma);
    const owner = await createMember(ctx.prisma, company.id, { role: "OWNER" });
    userCookie = await login(ctx.http, owner.email);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("[#1] SUPERADMIN acessa os endpoints administrativos", async () => {
    for (const path of ["/api/admin/dashboard", "/api/admin/companies", "/api/admin/users"]) {
      const response = await ctx.http.get(path).set("Cookie", adminCookie);
      expect(response.status, path).toBe(200);
    }
  });

  it("[#2] usuário comum recebe 403 em todos os endpoints administrativos", async () => {
    const company = await createCompany(ctx.prisma);
    const gets = [
      "/api/admin/dashboard",
      "/api/admin/companies",
      "/api/admin/users",
      `/api/admin/companies/${company.id}`,
      `/api/admin/companies/${company.id}/members`,
    ];
    for (const path of gets) {
      expect((await ctx.http.get(path).set("Cookie", userCookie)).status, path).toBe(403);
    }
    expect((await post("/api/admin/companies", userCookie, validCompany)).status).toBe(403);
    expect(
      (
        await post(`/api/admin/companies/${company.id}/members`, userCookie, {
          name: "Invasor",
          email: "invasor@test.local",
          password: "senha-invasor-123",
          role: "OWNER",
        })
      ).status,
    ).toBe(403);
    expect(await ctx.prisma.company.count()).toBe(2);
  });

  it("[#2] endpoint administrativo sem sessão recebe 401", async () => {
    expect((await ctx.http.get("/api/admin/dashboard")).status).toBe(401);
  });

  it("[#4] SUPERADMIN cria empresa com status ONBOARDING e registro de auditoria", async () => {
    const response = await post("/api/admin/companies", adminCookie, validCompany);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: "Clínica São João",
      slug: "clinica-sao-joao",
      status: "ONBOARDING",
      cnpj: "11222333000181",
      phone: "1133334444",
    });
    const created = response.body as CompanyDetail;
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "company.created", entityId: created.id } });
    expect(audit?.companyId).toBe(created.id);
  });

  it("[#4] status enviado pelo cliente é rejeitado (campo desconhecido)", async () => {
    const response = await post("/api/admin/companies", adminCookie, { ...validCompany, status: "ACTIVE" });
    expect(response.status).toBe(400);
  });

  it("[#5] slug é único em criações sequenciais", async () => {
    const first = await post("/api/admin/companies", adminCookie, validCompany);
    const second = await post("/api/admin/companies", adminCookie, validCompany);
    expect((first.body as CompanyDetail).slug).toBe("clinica-sao-joao");
    expect((second.body as CompanyDetail).slug).toBe("clinica-sao-joao-2");
  });

  it("[#5] slug é único com criações simultâneas do mesmo nome", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post("/api/admin/companies", adminCookie, { ...validCompany, name: "Acme Ltda" })),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    const slugs = responses.map((response) => (response.body as CompanyDetail).slug);
    expect(new Set(slugs).size).toBe(5);
    expect([...slugs].sort()).toEqual(["acme-ltda", "acme-ltda-2", "acme-ltda-3", "acme-ltda-4", "acme-ltda-5"]);
  });

  describe("[#12] payload inválido recebe 400", () => {
    it("e-mail inválido", async () => {
      const response = await post("/api/admin/companies", adminCookie, { ...validCompany, email: "nao-e-email" });
      expect(response.status).toBe(400);
      expect((response.body as ApiError).details).toContainEqual({ path: "email", message: "E-mail inválido." });
    });

    it("enum inválido", async () => {
      const company = await createCompany(ctx.prisma);
      const response = await post(`/api/admin/companies/${company.id}/members`, adminCookie, {
        name: "Fulano",
        email: "fulano@test.local",
        password: "senha-valida-123",
        role: "SUPERADMIN",
      });
      expect(response.status).toBe(400);
      expect((response.body as ApiError).details?.[0]?.path).toBe("role");
    });

    it("campo extra", async () => {
      const response = await post("/api/admin/companies", adminCookie, { ...validCompany, isAdmin: true });
      expect(response.status).toBe(400);
      expect((response.body as ApiError).details?.[0]?.message).toContain("isAdmin");
    });

    it("CNPJ com dígito verificador inválido", async () => {
      const response = await post("/api/admin/companies", adminCookie, { ...validCompany, cnpj: "11.222.333/0001-82" });
      expect(response.status).toBe(400);
    });

    it("CNPJ alfanumérico válido é aceito", async () => {
      const response = await post("/api/admin/companies", adminCookie, { ...validCompany, cnpj: "12.ABC.345/01DE-35" });
      expect(response.status).toBe(201);
      expect((response.body as CompanyDetail).cnpj).toBe("12ABC34501DE35");
    });

    it("e-mail inválido no login e query com pageSize acima do limite", async () => {
      const loginResponse = await ctx.http.post("/api/auth/login").set("Origin", ORIGIN).send({ email: "x", password: "y" });
      expect(loginResponse.status).toBe(400);
      const list = await ctx.http.get("/api/admin/companies?pageSize=1000").set("Cookie", adminCookie);
      expect(list.status).toBe(400);
    });

    it("JSON malformado", async () => {
      const response = await ctx.http
        .post("/api/admin/companies")
        .set("Origin", ORIGIN)
        .set("Cookie", adminCookie)
        .set("Content-Type", "application/json")
        .send("{quebrado");
      expect(response.status).toBe(400);
    });
  });

  it("dashboard mostra números reais do banco", async () => {
    await createCompany(ctx.prisma, { status: "ONBOARDING" });
    await createCompany(ctx.prisma, { status: "PAUSED" });
    const response = await ctx.http.get("/api/admin/dashboard").set("Cookie", adminCookie);
    expect((response.body as AdminDashboardResponse).totals).toEqual({ companies: 3, activeCompanies: 1, onboardingCompanies: 1, users: 2 });
    expect((response.body as AdminDashboardResponse).recentCompanies).toHaveLength(3);
  });

  it("dashboard com banco vazio mostra zeros", async () => {
    await resetDatabase(ctx.prisma);
    const admin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    const cookie = await login(ctx.http, admin.email);
    const response = await ctx.http.get("/api/admin/dashboard").set("Cookie", cookie);
    expect(response.body).toEqual({
      totals: { companies: 0, activeCompanies: 0, onboardingCompanies: 0, users: 1 },
      recentCompanies: [],
    });
  });

  it("lista empresas com busca case-insensitive e paginação", async () => {
    await createCompany(ctx.prisma, { name: "Padaria Pão Quente" });
    await createCompany(ctx.prisma, { name: "PADARIA do Zé" });
    const search = await ctx.http.get("/api/admin/companies?q=padaria").set("Cookie", adminCookie);
    expect((search.body as Paginated<CompanySummary>).total).toBe(2);
    const page = await ctx.http.get("/api/admin/companies?pageSize=1&page=2").set("Cookie", adminCookie);
    expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect((page.body as Paginated<CompanySummary>).items).toHaveLength(1);
  });

  describe("criação de usuário de empresa", () => {
    it("cria User com mustChangePassword e CompanyMember, com auditoria", async () => {
      const company = await createCompany(ctx.prisma);
      const response = await post(`/api/admin/companies/${company.id}/members`, adminCookie, {
        name: "Maria Admin",
        email: "  Maria@Empresa.COM ",
        password: "senha-inicial-123",
        role: "ADMIN",
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ role: "ADMIN", user: { email: "maria@empresa.com", mustChangePassword: true } });

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: "maria@empresa.com" } });
      expect(user.globalRole).toBe("USER");
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await ctx.prisma.auditLog.count({ where: { action: "user.created", companyId: company.id } })).toBe(1);

      const members = await ctx.http.get(`/api/admin/companies/${company.id}/members`).set("Cookie", adminCookie);
      expect(members.body).toHaveLength(1);
    });

    it("e-mail já existente retorna 409 sem criar nada", async () => {
      const company = await createCompany(ctx.prisma);
      const existing = await createUser(ctx.prisma);
      const before = await ctx.prisma.user.count();
      const response = await post(`/api/admin/companies/${company.id}/members`, adminCookie, {
        name: "Duplicado",
        email: existing.email,
        password: "senha-inicial-123",
        role: "AGENT",
      });
      expect(response.status).toBe(409);
      expect((response.body as ApiError).message).toBe("Já existe um usuário com este e-mail.");
      expect(await ctx.prisma.user.count()).toBe(before);
    });

    it("senha abaixo da política mínima retorna 400", async () => {
      const company = await createCompany(ctx.prisma);
      const response = await post(`/api/admin/companies/${company.id}/members`, adminCookie, {
        name: "Fulano",
        email: "fulano@test.local",
        password: "123456789",
        role: "AGENT",
      });
      expect(response.status).toBe(400);
    });

    it("empresa inexistente retorna 404 para o SUPERADMIN", async () => {
      const response = await ctx.http
        .get("/api/admin/companies/00000000-0000-7000-8000-000000000000")
        .set("Cookie", adminCookie);
      expect(response.status).toBe(404);
      expect((await ctx.http.get("/api/admin/companies/nao-e-uuid").set("Cookie", adminCookie)).status).toBe(404);
    });
  });
});
