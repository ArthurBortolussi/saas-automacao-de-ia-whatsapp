import type { MeResponse } from "@arthur-ai/shared";
import type { Company } from "@arthur-ai/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany, createMember, createTestApp, createUser, login, resetDatabase, type TestContext } from "./helpers.js";

describe("Isolamento multi-tenant", () => {
  let ctx: TestContext;
  let companyA: Company;
  let companyB: Company;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Empresa A" });
    companyB = await createCompany(ctx.prisma, { name: "Empresa B" });
    cookieA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id)).email);
    cookieB = await login(ctx.http, (await createMember(ctx.prisma, companyB.id)).email);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("[#6] usuário vinculado acessa a própria empresa", async () => {
    const response = await ctx.http.get(`/api/companies/${companyA.id}`).set("Cookie", cookieA);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: companyA.id, name: "Empresa A" });

    const me = await ctx.http.get("/api/auth/me").set("Cookie", cookieA);
    expect((me.body as MeResponse).membership).toMatchObject({ role: "OWNER", company: { id: companyA.id } });
  });

  it("[#3] usuário da Empresa A recebe 403 ao trocar o companyId da URL para a Empresa B", async () => {
    const response = await ctx.http.get(`/api/companies/${companyB.id}`).set("Cookie", cookieA);
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain("Empresa B");

    const reverse = await ctx.http.get(`/api/companies/${companyA.id}`).set("Cookie", cookieB);
    expect(reverse.status).toBe(403);
  });

  it("[#3] empresa inexistente e ID malformado respondem 403 (não vaza existência)", async () => {
    for (const id of ["00000000-0000-7000-8000-000000000000", "nao-e-uuid", "' OR 1=1 --"]) {
      const response = await ctx.http.get(`/api/companies/${encodeURIComponent(id)}`).set("Cookie", cookieA);
      expect(response.status, id).toBe(403);
    }
  });

  it("AGENT acessa somente a própria empresa", async () => {
    const agentCookie = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "AGENT" })).email);
    expect((await ctx.http.get(`/api/companies/${companyA.id}`).set("Cookie", agentCookie)).status).toBe(200);
    expect((await ctx.http.get(`/api/companies/${companyB.id}`).set("Cookie", agentCookie)).status).toBe(403);
  });

  it("SUPERADMIN acessa qualquer empresa sem vínculo", async () => {
    const admin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    const cookie = await login(ctx.http, admin.email);
    expect((await ctx.http.get(`/api/companies/${companyA.id}`).set("Cookie", cookie)).status).toBe(200);
    expect((await ctx.http.get(`/api/companies/${companyB.id}`).set("Cookie", cookie)).status).toBe(200);
  });

  describe("[#10] status da empresa", () => {
    it.each(["PAUSED", "INACTIVE"] as const)("membro de empresa %s recebe 403 com mensagem clara", async (status) => {
      const company = await createCompany(ctx.prisma, { status });
      const cookie = await login(ctx.http, (await createMember(ctx.prisma, company.id)).email);
      const response = await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: "COMPANY_SUSPENDED", message: "Acesso suspenso. Contate o suporte." });

      // /me continua funcionando para o frontend exibir o aviso.
      const me = await ctx.http.get("/api/auth/me").set("Cookie", cookie);
      expect((me.body as MeResponse).membership?.company.status).toBe(status);
    });

    it("empresa pausada depois do login bloqueia no próximo request", async () => {
      const company = await createCompany(ctx.prisma, { status: "ACTIVE" });
      const cookie = await login(ctx.http, (await createMember(ctx.prisma, company.id)).email);
      expect((await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie)).status).toBe(200);
      await ctx.prisma.company.update({ where: { id: company.id }, data: { status: "PAUSED" } });
      expect((await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie)).status).toBe(403);
    });

    it("membro de empresa ONBOARDING acessa normalmente", async () => {
      const company = await createCompany(ctx.prisma, { status: "ONBOARDING" });
      const cookie = await login(ctx.http, (await createMember(ctx.prisma, company.id)).email);
      expect((await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie)).status).toBe(200);
    });

    it("SUPERADMIN não é afetado por empresa PAUSED", async () => {
      const company = await createCompany(ctx.prisma, { status: "PAUSED" });
      const admin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
      const cookie = await login(ctx.http, admin.email);
      expect((await ctx.http.get(`/api/companies/${company.id}`).set("Cookie", cookie)).status).toBe(200);
    });
  });
});
