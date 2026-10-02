import type { Company } from "@arthur-ai/database";
import { API_ERROR_CODES, type TeamResponse } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCompany, createTestApp, createUser, login, PASSWORD, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";

describe("Equipe: cadastro, permissões, isolamento e disponibilidade", () => {
  let ctx: TestContext;
  let companyA: Company;
  let companyB: Company;
  let ownerA: MemberHandle;
  let adminA: MemberHandle;
  let agentA: MemberHandle;
  let ownerB: MemberHandle;
  let superadmin: string;
  const team = (company: Company) => `/companies/${company.id}/team`;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Clínica A" });
    companyB = await createCompany(ctx.prisma, { name: "Loja B" });
    ownerA = await addMember(ctx, companyA.id, { role: "OWNER" });
    adminA = await addMember(ctx, companyA.id, { role: "ADMIN" });
    agentA = await addMember(ctx, companyA.id, { role: "AGENT" });
    ownerB = await addMember(ctx, companyB.id, { role: "OWNER" });
    superadmin = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("[#1] cadastro de funcionários", () => {
    it("proprietário cadastra com senha provisória; o novo usuário precisa trocá-la no primeiro acesso", async () => {
      const response = await as(ctx, ownerA.cookie).post(`${team(companyA)}/members`, {
        name: "Nova Atendente",
        email: "nova@clinica.test",
        password: "senha-provisoria-123",
        role: "AGENT",
        maxConcurrent: 3,
        canAttend: true,
      });
      expect(response.status).toBe(201);
      const created = (response.body as TeamResponse).members.find((member) => member.email === "nova@clinica.test");
      expect(created).toMatchObject({ role: "AGENT", maxConcurrent: 3, availability: "AWAY", active: true, mustChangePassword: true });
      expect(JSON.stringify(response.body)).not.toMatch(/senha-provisoria|passwordHash|argon2/);

      const cookie = await login(ctx.http, "nova@clinica.test", "senha-provisoria-123");
      const blocked = await ctx.http.get(`/api${team(companyA)}`).set("Cookie", cookie);
      expect(blocked.status).toBe(403);
      expect((blocked.body as { code?: string }).code).toBe(API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
      expect(await ctx.prisma.auditLog.count({ where: { action: "user.created", companyId: companyA.id } })).toBe(1);
    });

    it("e-mail repetido e dados inválidos são recusados", async () => {
      const body = { name: "X Y", email: agentA.email, password: "senha-provisoria-123", role: "AGENT" };
      expect((await as(ctx, ownerA.cookie).post(`${team(companyA)}/members`, body)).status).toBe(409);
      for (const invalid of [
        { ...body, email: "outro@x.test", password: "curta" },
        { ...body, email: "outro@x.test", maxConcurrent: 0 },
        { ...body, email: "outro@x.test", role: "SUPERADMIN" },
        { ...body, email: "outro@x.test", companyId: companyB.id },
      ]) {
        expect((await as(ctx, ownerA.cookie).post(`${team(companyA)}/members`, invalid)).status).toBe(400);
      }
    });
  });

  describe("[#2] proprietário e administrador", () => {
    it("administrador cadastra e gerencia atendentes, mas não mexe em proprietários", async () => {
      const created = await as(ctx, adminA.cookie).post(`${team(companyA)}/members`, {
        name: "Atendente Dois",
        email: "dois@clinica.test",
        password: "senha-provisoria-123",
        role: "AGENT",
      });
      expect(created.status).toBe(201);
      expect(
        (await as(ctx, adminA.cookie).post(`${team(companyA)}/members`, { name: "Dono Dois", email: "d2@x.test", password: "senha-provisoria-123", role: "OWNER" })).status,
      ).toBe(403);
      expect((await as(ctx, adminA.cookie).patch(`${team(companyA)}/members/${ownerA.id}`, { maxConcurrent: 2 })).status).toBe(403);
      expect((await as(ctx, adminA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { role: "OWNER" })).status).toBe(403);

      const updated = await as(ctx, adminA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { maxConcurrent: 8, canAttend: false });
      expect(updated.status).toBe(200);
      expect((updated.body as TeamResponse).members.find((member) => member.userId === agentA.id)).toMatchObject({ maxConcurrent: 8, canAttend: false });
      const actions = (await ctx.prisma.auditLog.findMany({ where: { companyId: companyA.id, entityType: "CompanyMember" } })).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["team.member_limit_changed", "team.member_can_attend_changed"]));
    });

    it("proprietário muda perfil, desativa (encerrando as sessões) e reativa; ninguém muda o próprio perfil", async () => {
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { role: "ADMIN" })).status).toBe(200);
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { active: false })).status).toBe(200);
      expect((await ctx.http.get(`/api${team(companyA)}`).set("Cookie", agentA.cookie)).status).toBe(401);
      expect((await ctx.http.post("/api/auth/login").set("Origin", "http://localhost:3000").send({ email: agentA.email, password: PASSWORD })).status).toBe(401);
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { active: true })).status).toBe(200);
      const member = await ctx.prisma.companyMember.findUniqueOrThrow({ where: { userId: agentA.id }, include: { user: true } });
      expect(member).toMatchObject({ role: "ADMIN", user: { status: "ACTIVE" } });

      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${ownerA.id}`, { active: false })).status).toBe(409);
      expect((await as(ctx, adminA.cookie).patch(`${team(companyA)}/members/${adminA.id}`, { role: "AGENT" })).status).toBe(409);
      // O próprio limite pode ser ajustado.
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${ownerA.id}`, { maxConcurrent: 2 })).status).toBe(200);
    });

    it("proprietário gerencia outro proprietário (o próprio perfil continua protegido)", async () => {
      const second = await addMember(ctx, companyA.id, { role: "OWNER" });
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${second.id}`, { role: "ADMIN" })).status).toBe(200);
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${second.id}`, { role: "OWNER" })).status).toBe(200);
      expect((await as(ctx, second.cookie).patch(`${team(companyA)}/members/${ownerA.id}`, { active: false })).status).toBe(200);
      expect((await as(ctx, ownerA.cookie).get(team(companyA))).status).toBe(401);
      // O único proprietário ativo agora é "second": ele não pode se rebaixar nem se desativar.
      expect((await as(ctx, second.cookie).patch(`${team(companyA)}/members/${second.id}`, { role: "ADMIN" })).status).toBe(409);
    });

    it("configura o tempo de inatividade da empresa", async () => {
      const response = await as(ctx, adminA.cookie).patch(`${team(companyA)}/settings`, { inactivityTimeoutMinutes: 30 });
      expect(response.status).toBe(200);
      expect((response.body as TeamResponse).settings.inactivityTimeoutMinutes).toBe(30);
      expect((await as(ctx, adminA.cookie).patch(`${team(companyA)}/settings`, { inactivityTimeoutMinutes: 1 })).status).toBe(400);
    });
  });

  describe("[#3] funcionário comum", () => {
    it("vê a equipe sem e-mails, muda só a própria disponibilidade e não administra nada", async () => {
      const list = await as(ctx, agentA.cookie).get(team(companyA));
      expect(list.status).toBe(200);
      const body = list.body as TeamResponse;
      expect(body.canManage).toBe(false);
      expect(body.members.every((member) => member.email === null && member.mustChangePassword === null)).toBe(true);
      expect(body.me?.userId).toBe(agentA.id);

      expect((await as(ctx, agentA.cookie).post(`${team(companyA)}/members`, { name: "Xx", email: "x@x.test", password: "senha-provisoria-123", role: "AGENT" })).status).toBe(403);
      expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/members/${adminA.id}`, { maxConcurrent: 1 })).status).toBe(403);
      expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { maxConcurrent: 50 })).status).toBe(403);
      expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/settings`, { inactivityTimeoutMinutes: 10 })).status).toBe(403);
      // Não há como mudar a disponibilidade de outra pessoa: a rota só altera a de quem está logado.
      expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/members/${adminA.id}`, { availability: "AVAILABLE" })).status).toBe(403);
    });
  });

  describe("[#5] disponibilidade", () => {
    it("é persistida no banco, auditada e validada", async () => {
      const response = await as(ctx, agentA.cookie).patch(`${team(companyA)}/me/availability`, { availability: "AVAILABLE" });
      expect(response.status).toBe(200);
      expect((response.body as TeamResponse).me?.availability).toBe("AVAILABLE");
      const row = await ctx.prisma.companyMember.findUniqueOrThrow({ where: { userId: agentA.id } });
      expect(row.availability).toBe("AVAILABLE");
      expect(row.availabilityChangedAt).not.toBeNull();
      expect(await ctx.prisma.auditLog.count({ where: { action: "team.availability_changed", companyId: companyA.id } })).toBe(1);
      for (const state of ["BUSY", "AWAY"]) {
        expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/me/availability`, { availability: state })).status).toBe(200);
      }
      expect((await as(ctx, agentA.cookie).patch(`${team(companyA)}/me/availability`, { availability: "DORMINDO" })).status).toBe(400);
    });
  });

  describe("[#4] isolamento entre empresas e supervisão do Superadmin", () => {
    it("ninguém vê nem altera a equipe de outra empresa; o Superadmin só consulta", async () => {
      expect((await as(ctx, ownerB.cookie).get(team(companyA))).status).toBe(403);
      expect((await as(ctx, ownerB.cookie).patch(`${team(companyA)}/members/${agentA.id}`, { maxConcurrent: 1 })).status).toBe(403);
      expect((await as(ctx, ownerB.cookie).patch(`${team(companyA)}/settings`, { inactivityTimeoutMinutes: 10 })).status).toBe(403);
      // Usuário da empresa B pela rota da A: não existe aqui.
      expect((await as(ctx, ownerA.cookie).patch(`${team(companyA)}/members/${ownerB.id}`, { maxConcurrent: 1 })).status).toBe(404);
      expect((await ctx.prisma.companyMember.findUniqueOrThrow({ where: { userId: ownerB.id } })).maxConcurrent).toBe(5);

      const supervised = await as(ctx, superadmin).get(team(companyA));
      expect(supervised.status).toBe(200);
      expect((supervised.body as TeamResponse).members.map((member) => member.email)).toContain(agentA.email);
      expect((supervised.body as TeamResponse).canManage).toBe(false);
      expect((await as(ctx, superadmin).patch(`${team(companyA)}/members/${agentA.id}`, { maxConcurrent: 1 })).status).toBe(403);
      expect((await as(ctx, superadmin).patch(`${team(companyA)}/me/availability`, { availability: "AVAILABLE" })).status).toBe(403);
      // Rota técnica da Fase 1 preservada.
      expect((await as(ctx, superadmin).get(`/admin/companies/${companyA.id}/members`)).status).toBe(200);
    });
  });
});
