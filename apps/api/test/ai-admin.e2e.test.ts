import type { Company } from "@arthur-ai/database";
import type { AiStatusResponse, AiUsageSummary, KnowledgeEntryItem, KnowledgeListResponse } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCompany, createMember, createTestApp, createUser, login, ORIGIN, resetDatabase, type TestContext } from "./helpers.js";

describe("IA: configurações, base de conhecimento e uso (permissões e isolamento)", () => {
  let ctx: TestContext;
  let companyA: Company;
  let companyB: Company;
  let superadmin: string;
  let ownerA: string;
  let adminA: string;
  let agentA: string;
  let ownerB: string;

  const as = (cookie: string) => ({
    get: (path: string) => ctx.http.get(`/api${path}`).set("Cookie", cookie),
    post: (path: string, body: unknown) => ctx.http.post(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN).send(body as object),
    patch: (path: string, body: unknown) => ctx.http.patch(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN).send(body as object),
    delete: (path: string) => ctx.http.delete(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Clínica A" });
    companyB = await createCompany(ctx.prisma, { name: "Loja B" });
    const sa = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    superadmin = await login(ctx.http, sa.email);
    ownerA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "OWNER" })).email);
    adminA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "ADMIN" })).email);
    agentA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "AGENT" })).email);
    ownerB = await login(ctx.http, (await createMember(ctx.prisma, companyB.id, { role: "OWNER" })).email);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("[#1] configuração da IA por empresa", () => {
    it("empresa sem configuração usa os padrões: IA desligada, modo IA, 24h, America/Sao_Paulo, mensagem padrão", async () => {
      const response = await as(ownerA).get(`/companies/${companyA.id}/ai`);
      expect(response.status).toBe(200);
      const body = response.body as AiStatusResponse;
      expect(body.settings).toMatchObject({
        enabled: false,
        defaultConversationMode: "AI",
        alwaysOn: true,
        timezone: "America/Sao_Paulo",
        handoffMessage: null,
        updatedAt: null,
      });
      expect(body.settings.effectiveHandoffMessage).toMatch(/encaminhar seu atendimento/);
      expect(body.platform).toEqual({ configured: false, simulated: false, model: "claude-sonnet-5-5" });
      expect(body.blockers).toEqual(expect.arrayContaining(["A IA está desligada para esta empresa."]));
      expect(JSON.stringify(body)).not.toMatch(/sk-ant|apiKey/i);
    });

    it("SUPERADMIN liga a IA, muda o modo padrão e o horário; outra empresa não é afetada", async () => {
      const response = await as(superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, {
        enabled: true,
        defaultConversationMode: "HUMAN",
        alwaysOn: false,
        scheduleDays: [5, 1, 1, 3],
        scheduleStart: "09:00",
        scheduleEnd: "17:30",
        timezone: "America/Manaus",
      });
      expect(response.status).toBe(200);
      const body = response.body as AiStatusResponse;
      expect(body.settings).toMatchObject({
        enabled: true,
        defaultConversationMode: "HUMAN",
        alwaysOn: false,
        scheduleDays: [1, 3, 5],
        scheduleStart: "09:00",
        scheduleEnd: "17:30",
        timezone: "America/Manaus",
      });
      const other = (await as(ownerB).get(`/companies/${companyB.id}/ai`)).body as AiStatusResponse;
      expect(other.settings.enabled).toBe(false);
      expect(other.settings.defaultConversationMode).toBe("AI");
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "ai.settings_updated", companyId: companyA.id } });
      expect(audit?.metadata).toMatchObject({ enabled: true, defaultConversationMode: "HUMAN" });
    });

    it("proprietário e administrador editam o atendimento (nome, tom, orientações, horário, mensagem de transferência)", async () => {
      const response = await as(ownerA).patch(`/companies/${companyA.id}/ai/settings`, {
        assistantName: "Bia",
        tone: "FRIENDLY",
        instructions: "Sempre ofereça o agendamento pelo site.",
        handoffMessage: "Um momento! Já chamo alguém da equipe.",
      });
      expect(response.status).toBe(200);
      expect((response.body as AiStatusResponse).settings).toMatchObject({
        assistantName: "Bia",
        tone: "FRIENDLY",
        effectiveHandoffMessage: "Um momento! Já chamo alguém da equipe.",
      });
      const byAdmin = await as(adminA).patch(`/companies/${companyA.id}/ai/settings`, { handoffMessage: "" });
      expect(byAdmin.status).toBe(200);
      expect((byAdmin.body as AiStatusResponse).settings.handoffMessage).toBeNull();
    });

    it("empresa NÃO liga a IA nem muda o modo padrão (campos técnicos recusados no backend)", async () => {
      for (const body of [{ enabled: true }, { defaultConversationMode: "HUMAN" }]) {
        const response = await as(ownerA).patch(`/companies/${companyA.id}/ai/settings`, body);
        expect(response.status).toBe(400);
      }
      expect((await as(ownerA).patch(`/admin/companies/${companyA.id}/ai/settings`, { enabled: true })).status).toBe(403);
      expect(await ctx.prisma.aiSettings.count()).toBe(0);
    });

    it("funcionário comum (AGENT) vê o estado, mas não edita", async () => {
      const status = await as(agentA).get(`/companies/${companyA.id}/ai`);
      expect(status.status).toBe(200);
      expect((status.body as AiStatusResponse).permissions).toEqual({ editSettings: false, editAdminSettings: false, editKnowledge: false });
      expect((await as(agentA).patch(`/companies/${companyA.id}/ai/settings`, { assistantName: "Hacker" })).status).toBe(403);
    });

    it("valida campos: fuso inexistente, horário mal formatado, início = fim, dias vazios, modo pausado, tamanho", async () => {
      const invalid = [
        { timezone: "Marte/Olympus" },
        { scheduleStart: "25:00" },
        { scheduleDays: [] },
        { scheduleDays: [7] },
        { assistantName: "x" },
        { instructions: "a".repeat(4001) },
        { campoEstranho: 1 },
        {},
      ];
      for (const body of invalid) {
        expect((await as(superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, body)).status).toBe(400);
      }
      expect((await as(superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, { defaultConversationMode: "PAUSED" })).status).toBe(400);
      const sameTime = await as(superadmin).patch(`/admin/companies/${companyA.id}/ai/settings`, {
        alwaysOn: false,
        scheduleStart: "10:00",
        scheduleEnd: "10:00",
      });
      expect(sameTime.status).toBe(400);
    });
  });

  describe("[#2 #4 #22] base de conhecimento: permissões, CRUD e isolamento", () => {
    const entry = { title: "Preço do clareamento", content: "O clareamento custa R$ 800 em até 4x.", category: "Preços" };

    it("proprietário cria, edita, desativa, reativa e exclui; tudo auditado", async () => {
      const created = await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, entry);
      expect(created.status).toBe(201);
      const item = created.body as KnowledgeEntryItem;
      expect(item).toMatchObject({ ...entry, active: true, position: 0 });

      const edited = await as(ownerA).patch(`/companies/${companyA.id}/knowledge-base/${item.id}`, { content: "Agora R$ 750.", position: 3 });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ content: "Agora R$ 750.", position: 3 });

      expect((await as(ownerA).patch(`/companies/${companyA.id}/knowledge-base/${item.id}`, { active: false })).body).toMatchObject({ active: false });
      expect((await as(adminA).patch(`/companies/${companyA.id}/knowledge-base/${item.id}`, { active: true })).body).toMatchObject({ active: true });

      expect((await as(adminA).delete(`/companies/${companyA.id}/knowledge-base/${item.id}`)).status).toBe(204);
      expect(await ctx.prisma.knowledgeEntry.count()).toBe(0);
      const actions = (await ctx.prisma.auditLog.findMany({ where: { entityType: "KnowledgeEntry" } })).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["knowledge.created", "knowledge.updated", "knowledge.deleted"]));
    });

    it("SUPERADMIN gerencia a base de qualquer empresa", async () => {
      const created = await as(superadmin).post(`/companies/${companyB.id}/knowledge-base`, entry);
      expect(created.status).toBe(201);
      const id = (created.body as KnowledgeEntryItem).id;
      expect((await as(superadmin).patch(`/companies/${companyB.id}/knowledge-base/${id}`, { title: "Novo título" })).status).toBe(200);
      expect((await as(superadmin).delete(`/companies/${companyB.id}/knowledge-base/${id}`)).status).toBe(204);
    });

    it("funcionário (AGENT) só consulta as ativas e não altera nada", async () => {
      const active = (await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, entry)).body as KnowledgeEntryItem;
      const inactive = (await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, { ...entry, title: "Rascunho", active: false }))
        .body as KnowledgeEntryItem;

      const list = await as(agentA).get(`/companies/${companyA.id}/knowledge-base?status=all`);
      expect(list.status).toBe(200);
      const body = list.body as KnowledgeListResponse;
      expect(body.canEdit).toBe(false);
      expect(body.items.map((item) => item.id)).toEqual([active.id]);
      expect((await as(agentA).get(`/companies/${companyA.id}/knowledge-base/${inactive.id}`)).status).toBe(404);

      expect((await as(agentA).post(`/companies/${companyA.id}/knowledge-base`, entry)).status).toBe(403);
      expect((await as(agentA).patch(`/companies/${companyA.id}/knowledge-base/${active.id}`, { title: "Mudei" })).status).toBe(403);
      expect((await as(agentA).delete(`/companies/${companyA.id}/knowledge-base/${active.id}`)).status).toBe(403);
      expect(await ctx.prisma.knowledgeEntry.count()).toBe(2);
    });

    it("busca por texto e filtro por estado", async () => {
      await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, entry);
      await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, { title: "Endereço", content: "Rua das Flores, 10", active: false });
      const search = (await as(ownerA).get(`/companies/${companyA.id}/knowledge-base?q=clareamento`)).body as KnowledgeListResponse;
      expect(search.items.map((item) => item.title)).toEqual(["Preço do clareamento"]);
      const inactive = (await as(ownerA).get(`/companies/${companyA.id}/knowledge-base?status=inactive`)).body as KnowledgeListResponse;
      expect(inactive.items.map((item) => item.title)).toEqual(["Endereço"]);
    });

    it("validação: campos obrigatórios, tamanhos e campos desconhecidos", async () => {
      const invalid = [
        {},
        { title: "x", content: "conteúdo válido" },
        { title: "Título", content: "c".repeat(10_001) },
        { ...entry, companyId: companyB.id },
        { ...entry, position: -1 },
      ];
      for (const body of invalid) expect((await as(ownerA).post(`/companies/${companyA.id}/knowledge-base`, body)).status).toBe(400);
    });

    it("isolamento: ninguém lê nem altera a base ou as configurações de outra empresa", async () => {
      const secret = (await as(ownerB).post(`/companies/${companyB.id}/knowledge-base`, { ...entry, content: "Segredo da Loja B" }))
        .body as KnowledgeEntryItem;

      // Rotas da empresa alheia: 403 (sem revelar se existe).
      expect((await as(ownerA).get(`/companies/${companyB.id}/knowledge-base`)).status).toBe(403);
      expect((await as(ownerA).get(`/companies/${companyB.id}/ai`)).status).toBe(403);
      expect((await as(ownerA).patch(`/companies/${companyB.id}/ai/settings`, { assistantName: "Invasor" })).status).toBe(403);
      expect((await as(ownerA).post(`/companies/${companyB.id}/knowledge-base`, entry)).status).toBe(403);

      // ID de outra empresa pela rota da PRÓPRIA empresa: 404, nada alterado.
      expect((await as(ownerA).get(`/companies/${companyA.id}/knowledge-base/${secret.id}`)).status).toBe(404);
      expect((await as(ownerA).patch(`/companies/${companyA.id}/knowledge-base/${secret.id}`, { content: "Hackeado" })).status).toBe(404);
      expect((await as(ownerA).delete(`/companies/${companyA.id}/knowledge-base/${secret.id}`)).status).toBe(404);
      expect((await ctx.prisma.knowledgeEntry.findUniqueOrThrow({ where: { id: secret.id } })).content).toBe("Segredo da Loja B");

      // A listagem da A nunca mostra a entrada da B.
      const listA = (await as(ownerA).get(`/companies/${companyA.id}/knowledge-base?q=Segredo`)).body as KnowledgeListResponse;
      expect(listA.total).toBe(0);

      // Rotas técnicas: só SUPERADMIN.
      expect((await as(ownerB).get(`/admin/companies/${companyB.id}/ai/usage`)).status).toBe(403);
    });
  });

  describe("[#15] aba Uso (SUPERADMIN)", () => {
    it("soma consumo por empresa, separa execuções sem consumo e sem preço, e não mistura empresas", async () => {
      const contact = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Cliente", phone: "5511999990001" } });
      const conversation = await ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contact.id, channel: "WHATSAPP" } });
      const contactB = await ctx.prisma.contact.create({ data: { companyId: companyB.id, name: "Cliente B", phone: "5511999990002" } });
      const conversationB = await ctx.prisma.conversation.create({ data: { companyId: companyB.id, contactId: contactB.id, channel: "WHATSAPP" } });
      const base = { companyId: companyA.id, conversationId: conversation.id, messageCount: 1 };
      await ctx.prisma.aiRun.createMany({
        data: [
          { id: crypto.randomUUID(), ...base, model: "claude-sonnet-5-5", result: "REPLIED", inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 2000, costUsd: "0.003400" },
          { id: crypto.randomUUID(), ...base, model: "claude-sonnet-5-5", result: "HANDOFF", inputTokens: 500, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: "0.001200" },
          { id: crypto.randomUUID(), ...base, model: "claude-sonnet-5-5", result: "ERROR", errorType: "rate_limit" },
          { id: crypto.randomUUID(), ...base, model: "modelo-desconhecido", result: "REPLIED", inputTokens: 10, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          { id: crypto.randomUUID(), companyId: companyB.id, conversationId: conversationB.id, messageCount: 1, model: "claude-sonnet-5-5", result: "REPLIED", inputTokens: 99_999, outputTokens: 99_999, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: "9.000000" },
        ],
      });
      const response = await as(superadmin).get(`/admin/companies/${companyA.id}/ai/usage?period=last30days`);
      expect(response.status).toBe(200);
      const usage = response.body as AiUsageSummary;
      expect(usage.runs).toBe(4);
      expect(usage.byResult).toEqual({ REPLIED: 2, HANDOFF: 1, DISCARDED: 0, ERROR: 1 });
      expect(usage.inputTokens).toBe(1510);
      expect(usage.outputTokens).toBe(130);
      expect(usage.cacheReadInputTokens).toBe(2000);
      expect(usage.estimatedCostUsd).toBe("0.004600");
      expect(usage.runsWithoutUsage).toBe(1);
      expect(usage.runsWithoutPrice).toBe(1);
      expect(usage.recent).toHaveLength(4);
      expect(usage.pricing).toMatchObject({ model: "claude-sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 });
      expect(usage.daily.reduce((sum, day) => sum + day.runs, 0)).toBe(4);
    });
  });
});
