import type { Company } from "@arthur-ai/database";
import {
  localDateTime,
  type AdminPlatformSettingsResponse,
  type CalendarResponse,
  type CompanySettingsResponse,
  type MeResponse,
  type ScheduleExceptionItem,
  type SupportContacts,
  type TeamResponse,
} from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCompany, createTestApp, createUser, login, ORIGIN, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, MockGraphApi, TEST_ENCRYPTION_KEY } from "./whatsapp-helpers.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("conteudo-de-teste-png")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("conteudo-de-teste-jpeg")]);
const SP = "America/Sao_Paulo";
const today = () => localDateTime(new Date(), SP).date;

const exception = (overrides: Record<string, unknown> = {}) => ({
  date: today(),
  label: "Feriado municipal",
  business: { mode: "DEFAULT" },
  ai: { mode: "DEFAULT" },
  team: { mode: "DEFAULT" },
  ...overrides,
});

describe("Fase 7 — Configurações da empresa, permissões e administração da plataforma", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let restore: () => void;
  let companyA: Company;
  let companyB: Company;
  let owner: MemberHandle;
  let admin: MemberHandle;
  let agent: MemberHandle;
  let ownerB: MemberHandle;
  let superadmin: string;

  const settingsOf = async (member: { cookie: string }, company = companyA) => {
    const response = await as(ctx, member.cookie).get(`/companies/${company.id}/settings`);
    expect(response.status).toBe(200);
    return response.body as CompanySettingsResponse;
  };
  const grant = (target: MemberHandle, permissions: string[], by: { cookie: string } = owner) =>
    ctx.http
      .put(`/api/companies/${companyA.id}/settings/permissions/${target.id}`)
      .set("Cookie", by.cookie)
      .set("Origin", ORIGIN)
      .send({ permissions, confirm: true });
  const put = (cookie: string, path: string, body: object) => ctx.http.put(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN).send(body);
  const del = (cookie: string, path: string) => ctx.http.delete(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN);
  const uploadLogo = (cookie: string, data: Buffer, type: string, company = companyA) =>
    ctx.http.put(`/api/companies/${company.id}/logo`).set("Cookie", cookie).set("Origin", ORIGIN).set("Content-Type", type).send(data);
  const auditActions = async () => (await ctx.prisma.auditLog.findMany({ where: { companyId: companyA.id }, select: { action: true } })).map((row) => row.action);

  beforeAll(async () => {
    graph = new MockGraphApi();
    await graph.start();
    restore = enableWhatsAppEnv(graph.url);
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    restore();
    await graph.stop();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Clínica A" });
    companyB = await createCompany(ctx.prisma, { name: "Loja B" });
    owner = await addMember(ctx, companyA.id, { role: "OWNER" });
    admin = await addMember(ctx, companyA.id, { role: "ADMIN" });
    agent = await addMember(ctx, companyA.id, { role: "AGENT" });
    ownerB = await addMember(ctx, companyB.id, { role: "OWNER" });
    superadmin = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
  });

  describe("[#1–#8] permissões individuais por grupo", () => {
    it("[#1] proprietário vê e edita todos os grupos e administra as permissões", async () => {
      const settings = await settingsOf(owner);
      expect(settings.permissions).toMatchObject({
        editAi: true,
        editService: true,
        editSchedule: true,
        editMessages: true,
        editCompany: true,
        managePermissions: true,
      });
      expect(settings.members?.map((member) => member.role).sort()).toEqual(["ADMIN", "AGENT", "OWNER"]);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, { welcomeEnabled: true })).status).toBe(200);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/service`, { maxQueueWaitMinutes: 15 })).status).toBe(200);
    });

    it("[#2 #3] administrador edita só os grupos concedidos; sem o grupo, 403 no backend", async () => {
      // ADMIN existente (como os migrados) tem todos os grupos.
      expect((await settingsOf(admin)).permissions).toMatchObject({ editAi: true, editSchedule: true, editCompany: false, managePermissions: false });
      expect((await grant(admin, ["MESSAGES"])).status).toBe(200);
      const limited = await settingsOf(admin);
      expect(limited.permissions).toMatchObject({ editAi: false, editSchedule: false, editMessages: true, editService: false, granted: ["MESSAGES"] });
      expect(limited.members).toBeNull();
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/settings/messages`, { closingEnabled: true })).status).toBe(200);
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { business: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } })).status).toBe(403);
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/ai/settings`, { assistantName: "Bia" })).status).toBe(403);
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/team/settings`, { inactivityTimeoutMinutes: 30 })).status).toBe(403);
    });

    it("[#4 #5] funcionário com permissão individual edita aquele grupo; sem permissão, só consulta", async () => {
      const before = await settingsOf(agent);
      expect(before.permissions).toMatchObject({ editAi: false, editService: false, editSchedule: false, editMessages: false });
      expect(before.schedules.business).toBeDefined();
      expect((await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { team: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } })).status).toBe(403);
      expect((await grant(agent, ["SCHEDULE", "AI"])).status).toBe(200);
      expect((await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { team: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } })).status).toBe(200);
      expect((await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/ai/settings`, { tone: "FRIENDLY" })).status).toBe(200);
      expect((await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/settings/messages`, { welcomeEnabled: true })).status).toBe(403);
      // Pausar a IA é do grupo "IA": o funcionário com o grupo pode.
      expect((await as(ctx, agent.cookie).post(`/companies/${companyA.id}/ai/pause`, { action: "PAUSE", confirm: true })).status).toBe(200);
    });

    it("[#6] ninguém administra as próprias permissões nem concede permissões (só o proprietário, a terceiros)", async () => {
      expect((await grant(admin, ["AI", "SERVICE", "SCHEDULE", "MESSAGES"], admin)).status).toBe(403);
      expect((await grant(agent, ["AI"], admin)).status).toBe(403);
      await grant(agent, ["MESSAGES"]);
      expect((await grant(agent, ["AI", "MESSAGES"], agent)).status).toBe(403);
      const self = await put(owner.cookie, `/companies/${companyA.id}/settings/permissions/${owner.id}`, { permissions: [], confirm: true });
      expect(self.status).toBe(403);
      expect((await put(superadmin, `/companies/${companyA.id}/settings/permissions/${agent.id}`, { permissions: ["AI"], confirm: true })).status).toBe(403);
      // Campo extra para tentar escalar (ex.: papel) é recusado pelo schema.
      expect((await put(owner.cookie, `/companies/${companyA.id}/settings/permissions/${agent.id}`, { permissions: [], confirm: true, role: "OWNER" })).status).toBe(400);
      expect((await settingsOf(agent)).permissions.granted).toEqual(["MESSAGES"]);
    });

    it("revogação vale na próxima operação, com a mesma sessão", async () => {
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/ai/settings`, { assistantName: "Bia" })).status).toBe(200);
      await grant(admin, []);
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/ai/settings`, { assistantName: "Ana" })).status).toBe(403);
    });

    it("ADMIN sem um grupo não o obtém criando outra conta de ADMIN (escalonamento por conta criada por ele)", async () => {
      await grant(admin, ["MESSAGES"]);
      const created = await as(ctx, admin.cookie).post(`/companies/${companyA.id}/team/members`, {
        name: "Novo Admin",
        email: "novo.admin@test.local",
        password: "senha-provisoria-123",
        role: "ADMIN",
      });
      expect(created.status).toBe(201);
      const member = await ctx.prisma.companyMember.findFirstOrThrow({ where: { user: { email: "novo.admin@test.local" } } });
      expect(member.settingsPermissions).toEqual(["MESSAGES"]);
      const byOwner = await as(ctx, owner.cookie).post(`/companies/${companyA.id}/team/members`, {
        name: "Outro Admin",
        email: "outro.admin@test.local",
        password: "senha-provisoria-123",
        role: "ADMIN",
      });
      expect(byOwner.status).toBe(201);
      const second = await ctx.prisma.companyMember.findFirstOrThrow({ where: { user: { email: "outro.admin@test.local" } } });
      expect(second.settingsPermissions.sort()).toEqual(["AI", "MESSAGES", "SCHEDULE", "SERVICE"]);
      const agentCreated = await ctx.prisma.companyMember.findFirstOrThrow({ where: { userId: agent.id } });
      expect(agentCreated.settingsPermissions).toEqual([]);
    });

    it("[#7] nome comercial, fuso e logotipo: exclusivos do proprietário", async () => {
      for (const member of [admin, agent]) {
        expect((await as(ctx, member.cookie).patch(`/companies/${companyA.id}/settings/company`, { name: "Outro Nome" })).status).toBe(403);
        expect((await uploadLogo(member.cookie, PNG, "image/png")).status).toBe(403);
      }
      expect((await as(ctx, superadmin).patch(`/companies/${companyA.id}/settings/company`, { name: "Outro Nome" })).status).toBe(403);
      const renamed = await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/company`, { name: "Clínica Sorriso", timezone: "America/Manaus" });
      expect(renamed.status).toBe(200);
      expect((renamed.body as CompanySettingsResponse).company).toMatchObject({ name: "Clínica Sorriso", timezone: "America/Manaus" });
      expect((renamed.body as CompanySettingsResponse).schedules.timezone).toBe("America/Manaus");
      const me = (await as(ctx, agent.cookie).get("/auth/me")).body as MeResponse;
      expect(me.membership?.company.name).toBe("Clínica Sorriso");
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/company`, { timezone: "Marte/Base" })).status).toBe(400);
    });

    it("[#8] isolamento: outra empresa → 403; membro de outra empresa como alvo → 404", async () => {
      expect((await as(ctx, owner.cookie).get(`/companies/${companyB.id}/settings`)).status).toBe(403);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyB.id}/settings/messages`, { welcomeEnabled: true })).status).toBe(403);
      expect((await grant(ownerB, ["AI"])).status).toBe(404);
      expect((await uploadLogo(owner.cookie, PNG, "image/png", companyB)).status).toBe(403);
      await uploadLogo(ownerB.cookie, PNG, "image/png", companyB);
      expect((await as(ctx, owner.cookie).get(`/companies/${companyB.id}/logo`)).status).toBe(403);
      expect(await ctx.prisma.companySettings.count({ where: { companyId: companyB.id } })).toBe(0);
    });
  });

  describe("logotipo", () => {
    it("upload validado pelos bytes; falha preserva o anterior; leitura isolada com cabeçalhos seguros", async () => {
      const first = await uploadLogo(owner.cookie, PNG, "image/png");
      expect(first.status).toBe(200);
      const fake = await uploadLogo(owner.cookie, Buffer.from("isto não é uma imagem"), "image/png");
      expect(fake.status).toBe(400);
      const mismatch = await uploadLogo(owner.cookie, JPEG, "image/png");
      expect(mismatch.status).toBe(400);
      const tooBig = await uploadLogo(owner.cookie, Buffer.concat([PNG, Buffer.alloc(600 * 1024)]), "image/png");
      expect(tooBig.status).toBe(413);
      const svg = await uploadLogo(owner.cookie, Buffer.from("<svg/>"), "image/svg+xml");
      expect(svg.status).toBe(400);

      const read = await as(ctx, agent.cookie).get(`/companies/${companyA.id}/logo`).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          done(null, Buffer.concat(chunks));
        });
      });
      expect(read.status).toBe(200);
      expect(read.headers["content-type"]).toMatch(/^image\/png/);
      expect(read.headers["x-content-type-options"]).toBe("nosniff");
      expect(read.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(Buffer.compare(read.body as Buffer, PNG)).toBe(0);
      const me = (await as(ctx, agent.cookie).get("/auth/me")).body as MeResponse;
      expect(me.membership?.company.logoVersion).toMatch(/^\d+$/);

      expect((await del(owner.cookie, `/companies/${companyA.id}/logo`)).status).toBe(204);
      expect((await as(ctx, owner.cookie).get(`/companies/${companyA.id}/logo`)).status).toBe(404);
      expect(await auditActions()).toEqual(expect.arrayContaining(["company.logo_updated", "company.logo_removed"]));
    });
  });

  describe("[#9–#11 #16–#19] horários independentes, calendário e datas especiais", () => {
    it("as três agendas são independentes: mudar uma não altera as outras", async () => {
      const response = await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, {
        business: { alwaysOn: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
      });
      expect(response.status).toBe(200);
      const body = response.body as CompanySettingsResponse;
      expect(body.schedules.business).toEqual({ alwaysOn: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" });
      expect(body.schedules.ai.alwaysOn).toBe(true);
      expect(body.schedules.team.alwaysOn).toBe(true);
      const ai = await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, {
        ai: { alwaysOn: false, days: [0, 6], start: "20:00", end: "06:00" },
      });
      const after = ai.body as CompanySettingsResponse;
      expect(after.schedules.ai).toEqual({ alwaysOn: false, days: [0, 6], start: "20:00", end: "06:00" });
      expect(after.schedules.business.start).toBe("09:00");
      // O horário da IA continua sendo a configuração da Fase 4 (uma única fonte).
      const aiRow = await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: companyA.id } });
      expect(aiRow).toMatchObject({ alwaysOn: false, scheduleDays: [0, 6], scheduleStart: "20:00", scheduleEnd: "06:00" });
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { team: { alwaysOn: false, days: [], start: "08:00", end: "18:00" } })).status).toBe(400);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { team: { alwaysOn: false, days: [1], start: "08:00", end: "08:00" } })).status).toBe(400);
    });

    it("calendário apresenta os feriados nacionais (só referência) e as datas especiais do ano", async () => {
      const calendar = (await as(ctx, agent.cookie).get(`/companies/${companyA.id}/settings/calendar?year=2026`)).body as CalendarResponse;
      expect(calendar.year).toBe(2026);
      expect(calendar.holidays).toHaveLength(10);
      expect(calendar.holidays).toContainEqual({ date: "2026-04-03", name: "Paixão de Cristo (Sexta-feira Santa)" });
      expect(calendar.canEdit).toBe(false);
      expect(calendar.exceptions).toEqual([]);
      expect((await as(ctx, agent.cookie).get(`/companies/${companyA.id}/settings/calendar?year=1500`)).status).toBe(400);
    });

    it("datas especiais: cadastro, exceções diferentes por agenda, edição, remoção e validação", async () => {
      // Negócio 24 h: o efeito observado é só o da data especial (independe do dia da semana em que o teste roda).
      await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { business: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } });
      const created = await as(ctx, owner.cookie).post(
        `/companies/${companyA.id}/settings/exceptions`,
        exception({ label: "Aniversário da cidade", business: { mode: "CLOSED" }, ai: { mode: "CUSTOM", start: "10:00", end: "12:00" }, team: { mode: "DEFAULT", start: "09:00" } }),
      );
      expect(created.status).toBe(201);
      const item = created.body as ScheduleExceptionItem;
      expect(item).toMatchObject({
        date: today(),
        business: { mode: "CLOSED", start: null, end: null },
        ai: { mode: "CUSTOM", start: "10:00", end: "12:00" },
        // Fora do horário especial, horários não são guardados.
        team: { mode: "DEFAULT", start: null, end: null },
      });
      const settings = await settingsOf(owner);
      expect(settings.openNow.business).toBe(false);
      expect(settings.openNow.team).toBe(true);
      expect((await as(ctx, owner.cookie).post(`/companies/${companyA.id}/settings/exceptions`, exception())).status).toBe(409);
      const year = Number(today().slice(0, 4));
      const listed = (await as(ctx, owner.cookie).get(`/companies/${companyA.id}/settings/calendar?year=${year}`)).body as CalendarResponse;
      expect(listed.exceptions.map((row) => row.label)).toEqual(["Aniversário da cidade"]);
      expect(listed.canEdit).toBe(true);

      const updated = await put(owner.cookie, `/companies/${companyA.id}/settings/exceptions/${item.id}`, exception({ label: "Ponto facultativo", team: { mode: "CLOSED" } }));
      expect(updated.status).toBe(200);
      expect((await settingsOf(owner)).openNow).toMatchObject({ business: true, team: false });
      expect((await put(ownerB.cookie, `/companies/${companyB.id}/settings/exceptions/${item.id}`, exception())).status).toBe(404);
      expect((await del(agent.cookie, `/companies/${companyA.id}/settings/exceptions/${item.id}`)).status).toBe(403);

      for (const invalid of [
        exception({ date: "2026-02-30" }),
        exception({ business: { mode: "CUSTOM", start: "10:00" } }),
        exception({ ai: { mode: "CUSTOM", start: "10:00", end: "10:00" } }),
        exception({ team: { mode: "FECHAR" } }),
        exception({ label: "x" }),
      ]) {
        expect((await as(ctx, owner.cookie).post(`/companies/${companyA.id}/settings/exceptions`, invalid)).status).toBe(400);
      }
      expect((await del(owner.cookie, `/companies/${companyA.id}/settings/exceptions/${item.id}`)).status).toBe(204);
      expect(await ctx.prisma.scheduleException.count()).toBe(0);
    });
  });

  describe("[#23 #33] mensagens automáticas e fila", () => {
    it("textos padrão em português, personalização e volta ao padrão com texto vazio", async () => {
      const defaults = await settingsOf(agent);
      expect(defaults.messages.welcome).toMatchObject({ enabled: false, message: null });
      expect(defaults.messages.queueNotice.enabled).toBe(true);
      expect(defaults.messages.afterHours.effective).toMatch(/fora do nosso horário/);
      const custom = await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, {
        welcomeEnabled: true,
        welcomeMessage: "Bem-vindo à Clínica A!",
        queueNoticeMessage: "Aguarde um instante, já vamos atender.",
      });
      expect(custom.status).toBe(200);
      const body = custom.body as CompanySettingsResponse;
      expect(body.messages.welcome).toMatchObject({ enabled: true, message: "Bem-vindo à Clínica A!", effective: "Bem-vindo à Clínica A!" });
      expect(body.messages.queueNotice.effective).toBe("Aguarde um instante, já vamos atender.");
      const reset = (await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, { welcomeMessage: "" })).body as CompanySettingsResponse;
      expect(reset.messages.welcome.message).toBeNull();
      expect(reset.messages.welcome.effective).toBe(reset.messages.welcome.defaultMessage);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, { welcomeMessage: "a".repeat(1001) })).status).toBe(400);
      expect((await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, {})).status).toBe(400);
    });

    it("limite de espera e prazo de inatividade: um único dado também visto na aba Equipe", async () => {
      const response = await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/settings/service`, { maxQueueWaitMinutes: 10, inactivityTimeoutMinutes: 90 });
      expect(response.status).toBe(200);
      expect((response.body as CompanySettingsResponse).service).toEqual({ maxQueueWaitMinutes: 10, inactivityTimeoutMinutes: 90 });
      const team = (await as(ctx, owner.cookie).get(`/companies/${companyA.id}/team`)).body as TeamResponse;
      expect(team.settings.inactivityTimeoutMinutes).toBe(90);
      expect(team.canEditSettings).toBe(true);
      expect((await as(ctx, admin.cookie).patch(`/companies/${companyA.id}/settings/service`, { maxQueueWaitMinutes: 0 })).status).toBe(400);
      expect((await as(ctx, superadmin).patch(`/companies/${companyA.id}/settings/service`, { maxQueueWaitMinutes: 5 })).status).toBe(403);
    });
  });

  describe("[#65 #66–#69] contatos de suporte e estado básico das integrações", () => {
    it("SUPERADMIN cadastra os contatos (validados); qualquer usuário autenticado consulta com links seguros", async () => {
      expect((await as(ctx, owner.cookie).patch("/admin/platform-settings", { supportEmail: "x@y.com" })).status).toBe(403);
      expect((await as(ctx, superadmin).patch("/admin/platform-settings", { supportEmail: "não-é-email" })).status).toBe(400);
      expect((await as(ctx, superadmin).patch("/admin/platform-settings", { supportWhatsapp: "abc" })).status).toBe(400);
      const empty = (await as(ctx, agent.cookie).get("/support")).body as SupportContacts;
      expect(empty).toEqual({ email: null, whatsapp: null, emailUrl: null, whatsappUrl: null });
      const saved = await as(ctx, superadmin).patch("/admin/platform-settings", { supportEmail: "Suporte@Arthur.ai", supportWhatsapp: "(11) 98888-7777" });
      expect(saved.status).toBe(200);
      const contacts = (await as(ctx, agent.cookie).get("/support")).body as SupportContacts;
      expect(contacts).toEqual({
        email: "suporte@arthur.ai",
        whatsapp: "5511988887777",
        emailUrl: "mailto:suporte@arthur.ai",
        whatsappUrl: "https://wa.me/5511988887777",
      });
      expect((await ctx.http.get("/api/support")).status).toBe(401);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "platform.settings_updated" }, orderBy: { createdAt: "desc" } });
      expect(audit?.metadata).toMatchObject({ supportEmail: "suporte@arthur.ai", supportWhatsapp: "5511988887777" });
    });

    it("estado das integrações: simulador identificado, nenhuma credencial na resposta, nada apresentado como validado", async () => {
      await createAccountRow(ctx.prisma, companyA.id, "555555555555555", { status: "ACTIVE" });
      await createAccountRow(ctx.prisma, companyB.id, "555555555555556", { status: "ERROR" });
      const response = await as(ctx, superadmin).get("/admin/platform-settings");
      expect(response.status).toBe(200);
      const body = response.body as AdminPlatformSettingsResponse;
      expect(body.integrations.whatsapp).toMatchObject({
        configured: true,
        environment: "SIMULATED",
        graphApiVersion: "v25.0",
        accounts: { active: 1, pending: 0, error: 1, disabled: 0 },
        observedSuccess: false,
      });
      // Sem chave da Anthropic nos testes: não configurada (nunca "conectada").
      expect(body.integrations.anthropic).toMatchObject({ configured: false, environment: "NOT_CONFIGURED", lastOfficialSuccessAt: null });
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(/token-da-|test-app-secret|test-verify-token|sk-ant|apiKey|secret/i);
      expect(raw).not.toContain(TEST_ENCRYPTION_KEY);
      expect((await as(ctx, owner.cookie).get("/admin/platform-settings")).status).toBe(403);
    });

    it("limite padrão da IA configurável só pelo SUPERADMIN, com validação de valor", async () => {
      expect((await as(ctx, superadmin).patch("/admin/platform-settings", { defaultAiMonthlyLimitUsd: 0 })).status).toBe(400);
      expect((await as(ctx, superadmin).patch("/admin/platform-settings", { defaultAiMonthlyLimitUsd: 10.555 })).status).toBe(400);
      const saved = (await as(ctx, superadmin).patch("/admin/platform-settings", { defaultAiMonthlyLimitUsd: 25.5 })).body as AdminPlatformSettingsResponse;
      expect(saved.settings.defaultAiMonthlyLimitUsd).toBe("25.50");
    });
  });

  describe("[#70 #71] auditoria e confirmação de operações críticas", () => {
    it("operações críticas exigem confirmação explícita também no backend", async () => {
      expect((await put(owner.cookie, `/companies/${companyA.id}/settings/permissions/${agent.id}`, { permissions: ["AI"] })).status).toBe(400);
      expect((await put(owner.cookie, `/companies/${companyA.id}/settings/permissions/${agent.id}`, { permissions: ["AI"], confirm: false })).status).toBe(400);
      expect((await as(ctx, owner.cookie).post(`/companies/${companyA.id}/ai/pause`, { action: "PAUSE" })).status).toBe(400);
      expect((await as(ctx, superadmin).post(`/admin/companies/${companyA.id}/suspend`, {})).status).toBe(400);
      // Retomar a IA não interrompe nada: não exige confirmação.
      expect((await as(ctx, owner.cookie).post(`/companies/${companyA.id}/ai/pause`, { action: "RESUME" })).status).toBe(200);
      expect((await ctx.prisma.companyMember.findFirstOrThrow({ where: { userId: agent.id } })).settingsPermissions).toEqual([]);
    });

    it("registra quem, quando, o quê e o grupo; nunca segredos", async () => {
      await grant(agent, ["MESSAGES"]);
      await grant(agent, ["AI"]);
      await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/company`, { name: "Clínica Nova" });
      await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/schedules`, { business: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } });
      await as(ctx, owner.cookie).post(`/companies/${companyA.id}/settings/exceptions`, exception());
      await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/messages`, { closingEnabled: true });
      await as(ctx, owner.cookie).patch(`/companies/${companyA.id}/settings/service`, { maxQueueWaitMinutes: 20 });
      await as(ctx, superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, { enabled: true });
      await as(ctx, owner.cookie).post(`/companies/${companyA.id}/ai/pause`, { action: "PAUSE", confirm: true });
      await as(ctx, owner.cookie).post(`/companies/${companyA.id}/ai/pause`, { action: "RESUME" });
      await as(ctx, superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, { monthlyLimitUsd: 50 });
      await as(ctx, superadmin).post(`/admin/companies/${companyA.id}/suspend`, { confirm: true });
      await as(ctx, superadmin).post(`/admin/companies/${companyA.id}/reactivate`, { confirm: true });
      const rows = await ctx.prisma.auditLog.findMany({ where: { companyId: companyA.id }, orderBy: { createdAt: "asc" } });
      expect(rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "settings.permissions_changed",
          "company.profile_updated",
          "settings.schedules_updated",
          "settings.exception_created",
          "settings.messages_updated",
          "settings.service_updated",
          "ai.paused",
          "ai.resumed",
          "ai.limit_updated",
          "company.suspended",
          "company.reactivated",
        ]),
      );
      const permissionRows = rows.filter((row) => row.action === "settings.permissions_changed");
      expect(permissionRows[1]?.metadata).toMatchObject({ userId: agent.id, granted: ["AI"], revoked: ["MESSAGES"] });
      expect(permissionRows[1]?.actorUserId).toBe(owner.id);
      expect(rows.find((row) => row.action === "company.profile_updated")?.metadata).toMatchObject({ from: "Clínica A", to: "Clínica Nova" });
      expect(rows.find((row) => row.action === "ai.limit_updated")?.metadata).toMatchObject({ from: null, to: "50.00", origin: "INDIVIDUAL" });
      expect(JSON.stringify(rows)).not.toMatch(/passwordHash|token-da-|sk-ant/);
    });
  });

  describe("compatibilidade com o seed e a migração", () => {
    it("empresa sem nenhuma configuração salva funciona com os padrões (equipe 24 h, aviso de fila ligado)", async () => {
      const settings = await settingsOf(owner);
      expect(settings.schedules.team.alwaysOn).toBe(true);
      expect(settings.openNow.team).toBe(true);
      expect(settings.messages.queueNotice.enabled).toBe(true);
      expect(settings.service.maxQueueWaitMinutes).toBe(30);
      expect(settings.ai).toEqual({ enabled: false, paused: false, pausedAt: null });
      expect(await ctx.prisma.companySettings.count()).toBe(0);
    });
  });
});
