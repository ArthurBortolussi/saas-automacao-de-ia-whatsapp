import type { Company, Conversation } from "@arthur-ai/database";
import type { AdminPlatformSettingsResponse, AiStatusResponse } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiBudgetService } from "../src/ai/ai-budget.service.js";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi, replyText } from "./ai-helpers.js";
import { createCompany, createContactRow, createConversationRow, createTestApp, createUser, login, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE = "999999999999991";
let customerSequence = 0;
const newCustomer = () => `55119${String(30_000_000 + (customerSequence += 1)).slice(-8)}`;
/** 225.000 tokens de entrada × US$ 2 por milhão = US$ 0,45 por execução (claude-sonnet-5-5). */
const EXPENSIVE = { input_tokens: 225_000, output_tokens: 0 };

describe("Fase 7 — pausa da IA e limite mensal de custo estimado", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let anthropic: MockAnthropicApi;
  let restore: (() => void)[] = [];
  let whatsapp: WhatsAppWorker;
  let ai: AiWorker;
  let team: TeamWorker;
  let company: Company;
  let owner: MemberHandle;
  let superadmin: string;

  const receive = async (from: string, text = "Olá") => {
    expect((await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE, from, text, wamid: nextWamid("wamid.IN") }))).status).toBe(200);
    await whatsapp.drain();
  };
  const settle = async () => {
    await whatsapp.drain();
    await ai.drain();
    await team.drain();
    await whatsapp.drain();
  };
  const customerSays = async (from: string, text = "Olá") => {
    await receive(from, text);
    await settle();
  };
  const conversationOf = (from: string): Promise<Conversation> => ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  const adminAi = (body: object, target = company) => as(ctx, superadmin).patch(`/admin/companies/${target.id}/ai/settings`, body);
  const pause = (cookie = owner.cookie) => as(ctx, cookie).post(`/companies/${company.id}/ai/pause`, { action: "PAUSE", confirm: true });
  const resume = (cookie = owner.cookie) => as(ctx, cookie).post(`/companies/${company.id}/ai/pause`, { action: "RESUME" });
  const statusAs = async (cookie: string, target = company) => (await as(ctx, cookie).get(`/companies/${target.id}/ai`)).body as AiStatusResponse;

  beforeAll(async () => {
    graph = new MockGraphApi();
    anthropic = new MockAnthropicApi();
    await graph.start();
    await anthropic.start();
    restore = [enableWhatsAppEnv(graph.url), enableAiEnv(anthropic.url, { AI_MAX_OUTPUT_TOKENS: "256" })];
    ctx = await createTestApp();
    whatsapp = ctx.app.get(WhatsAppWorker);
    ai = ctx.app.get(AiWorker);
    team = ctx.app.get(TeamWorker);
  });

  afterAll(async () => {
    await ctx.app.close();
    for (const undo of restore) undo();
    await graph.stop();
    await anthropic.stop();
  });

  beforeEach(async () => {
    await settle();
    await resetDatabase(ctx.prisma);
    graph.reset();
    anthropic.reset();
    company = await createCompany(ctx.prisma, { name: "Clínica A" });
    await createAccountRow(ctx.prisma, company.id, PHONE);
    owner = await addMember(ctx, company.id, { role: "OWNER" });
    superadmin = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
    expect((await adminAi({ enabled: true })).status).toBe(200);
  });

  describe("[#38–#43] pausa e retomada da IA pela empresa", () => {
    it("[#38 #41] pausada: nenhuma geração; novas mensagens vão para a equipe respeitando a distribuição", async () => {
      const paused = await pause();
      expect(paused.status).toBe(200);
      expect((paused.body as AiStatusResponse).settings.paused).toBe(true);
      expect((paused.body as AiStatusResponse).blockers.join(" ")).toMatch(/pausada/);
      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      await customerSays(customer, "Preciso de ajuda");
      expect(anthropic.requests).toHaveLength(0);
      expect(await conversationOf(customer)).toMatchObject({ mode: "HUMAN", status: "ASSIGNED", assignedUserId: agent.id, aiHandoffReason: "AI_PAUSED" });
      // Sem ninguém disponível, fica na fila.
      await as(ctx, agent.cookie).patch(`/companies/${company.id}/team/me/availability`, { availability: "AWAY" });
      const other = newCustomer();
      await customerSays(other, "Oi");
      expect(await conversationOf(other)).toMatchObject({ mode: "HUMAN", status: "QUEUED" });
      // Encaminhar por pausa não é uma "transferência feita pela IA" no Analytics.
      expect((await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversation: { contact: { phone: other } } } })).aiHandoffCount).toBe(0);
    });

    it("[#39 #42] retomada: próximas mensagens voltam para a IA; atendimentos humanos continuam com a equipe; nada retroativo", async () => {
      await pause();
      const duringPause = newCustomer();
      await customerSays(duringPause, "Mensagem durante a pausa");
      expect((await resume()).status).toBe(200);
      await settle();
      expect(anthropic.requests).toHaveLength(0);
      await customerSays(duringPause, "Continuo aqui");
      expect((await conversationOf(duringPause)).mode).toBe("HUMAN");
      expect(anthropic.requests).toHaveLength(0);
      const fresh = newCustomer();
      await customerSays(fresh, "Olá, IA?");
      expect(anthropic.requests).toHaveLength(1);
      expect((await conversationOf(fresh)).mode).toBe("AI");
    });

    it("[#40] desabilitada pelo SUPERADMIN: a empresa não retoma por conta própria", async () => {
      await pause();
      expect((await adminAi({ enabled: false })).status).toBe(200);
      const attempt = await resume();
      expect(attempt.status).toBe(409);
      expect((await statusAs(owner.cookie)).settings.paused).toBe(true);
      // Pausa e habilitação são estados separados: reabilitar não despausa.
      await adminAi({ enabled: true });
      expect((await statusAs(owner.cookie)).settings).toMatchObject({ enabled: true, paused: true });
      expect((await resume()).status).toBe(200);
    });

    it("[#43] tarefas pendentes são invalidadas e o cliente que esperava a IA vai para a fila", async () => {
      const customer = newCustomer();
      await receive(customer, "Mensagem ainda não respondida");
      expect(await ctx.prisma.aiReplyTask.count({ where: { status: "PENDING" } })).toBe(1);
      await pause();
      expect(await ctx.prisma.aiReplyTask.findFirstOrThrow()).toMatchObject({ status: "CANCELED", outcome: "AI_PAUSED" });
      expect(await conversationOf(customer)).toMatchObject({ mode: "HUMAN", status: "QUEUED" });
      await settle();
      expect(anthropic.requests).toHaveLength(0);
    });

    it("geração em andamento quando a IA é pausada: a resposta não é enviada (envio tardio bloqueado)", async () => {
      let release: () => void = () => undefined;
      anthropic.respondWith(
        () =>
          new Promise((resolve) => {
            release = () => {
              resolve(replyText("Resposta que chegou tarde"));
            };
          }),
      );
      const customer = newCustomer();
      await receive(customer, "Oi");
      const running = ai.drain();
      for (let attempt = 0; attempt < 200 && anthropic.requests.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(anthropic.requests).toHaveLength(1);
      await pause();
      release();
      await running;
      await settle();
      const sent = graph.messageRequests().map((request) => JSON.stringify(request.body));
      expect(sent.some((body) => body.includes("Resposta que chegou tarde"))).toBe(false);
      expect(await ctx.prisma.aiRun.findFirstOrThrow()).toMatchObject({ result: "DISCARDED" });
    });

    it("pausar/retomar exige o grupo IA (funcionário sem permissão → 403) e é por empresa", async () => {
      const agent = await addMember(ctx, company.id, { role: "AGENT" });
      expect((await pause(agent.cookie)).status).toBe(403);
      const other = await createCompany(ctx.prisma, { name: "Loja B" });
      const otherOwner = await addMember(ctx, other.id, { role: "OWNER" });
      expect((await as(ctx, otherOwner.cookie).post(`/companies/${company.id}/ai/pause`, { action: "PAUSE", confirm: true })).status).toBe(403);
      expect((await statusAs(owner.cookie)).settings.paused).toBe(false);
    });
  });

  describe("[#44–#53] limite mensal de custo estimado", () => {
    it("[#44] limite padrão aplicado na habilitação; mudar o padrão não altera quem já tem limite", async () => {
      await as(ctx, superadmin).patch("/admin/platform-settings", { defaultAiMonthlyLimitUsd: 20 });
      const fresh = await createCompany(ctx.prisma, { name: "Nova" });
      expect((await adminAi({ enabled: true }, fresh)).status).toBe(200);
      expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: fresh.id } })).monthlyLimitUsd?.toFixed(2)).toBe("20.00");
      // A empresa do beforeEach já estava habilitada antes do padrão existir: continua sem limite.
      expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: company.id } })).monthlyLimitUsd).toBeNull();
      await as(ctx, superadmin).patch("/admin/platform-settings", { defaultAiMonthlyLimitUsd: 50 });
      await adminAi({ enabled: false }, fresh);
      await adminAi({ enabled: true }, fresh);
      expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: fresh.id } })).monthlyLimitUsd?.toFixed(2)).toBe("20.00");
      const another = await createCompany(ctx.prisma, { name: "Outra" });
      await adminAi({ enabled: true }, another);
      expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: another.id } })).monthlyLimitUsd?.toFixed(2)).toBe("50.00");
    });

    it("[#45 #53] limite individual só pelo SUPERADMIN; a empresa não vê valores", async () => {
      expect((await adminAi({ monthlyLimitUsd: 1 })).status).toBe(200);
      expect((await as(ctx, owner.cookie).patch(`/companies/${company.id}/ai/settings`, { monthlyLimitUsd: 999 })).status).toBe(400);
      expect((await as(ctx, owner.cookie).patch(`/admin/companies/${company.id}/ai/settings`, { monthlyLimitUsd: 999 })).status).toBe(403);
      expect((await as(ctx, owner.cookie).get(`/admin/companies/${company.id}/ai/usage`)).status).toBe(403);
      const forCompany = await statusAs(owner.cookie);
      expect(forCompany.budget).toBeNull();
      expect(forCompany.usageLevel).toBe("OK");
      expect(JSON.stringify(forCompany)).not.toMatch(/usd|cost|limitUsd|spent/i);
      const agent = await addMember(ctx, company.id, { role: "AGENT" });
      expect((await statusAs(agent.cookie)).usageLevel).toBeNull();
      const forAdmin = await statusAs(superadmin);
      expect(forAdmin.budget).toMatchObject({ limitUsd: "1.00", enforcedSource: "SIMULATED", spentUsd: "0.000000", level: "OK" });
    });

    it("[#46 #47 #48 #50] alerta em 80%, bloqueio em 100% com encaminhamento à equipe, e aumento do limite libera", async () => {
      await adminAi({ monthlyLimitUsd: 1 });
      anthropic.respondWith(() => replyText("Resposta cara", EXPENSIVE));
      await customerSays(newCustomer());
      expect((await statusAs(owner.cookie)).usageLevel).toBe("OK");
      await customerSays(newCustomer());
      // US$ 0,90 de US$ 1,00 → 80% atingido.
      expect((await statusAs(owner.cookie)).usageLevel).toBe("NEAR_LIMIT");
      expect((await statusAs(superadmin)).budget).toMatchObject({ spentUsd: "0.900000", percent: 90, level: "NEAR_LIMIT" });
      const alerts = (await as(ctx, superadmin).get("/admin/alerts")).body as { aiLimitAlerts: { companyId: string; level: string }[] };
      expect(alerts.aiLimitAlerts).toEqual([expect.objectContaining({ companyId: company.id, level: "NEAR_LIMIT", source: "SIMULATED" })]);
      // Ainda cabe a estimativa da próxima execução: ela roda e ultrapassa (o custo real só é conhecido depois).
      await customerSays(newCustomer());
      expect(anthropic.requests).toHaveLength(3);
      expect((await statusAs(owner.cookie)).usageLevel).toBe("LIMIT_REACHED");
      expect((await statusAs(owner.cookie)).blockers.join(" ")).toMatch(/limite mensal/);

      const blocked = newCustomer();
      await customerSays(blocked, "Olá?");
      expect(anthropic.requests).toHaveLength(3);
      expect(await conversationOf(blocked)).toMatchObject({ mode: "HUMAN", status: "QUEUED", aiHandoffReason: "AI_LIMIT_REACHED" });
      // Alertas registrados uma única vez por patamar no mês.
      expect((await ctx.prisma.aiUsageAlert.findMany({ orderBy: { threshold: "asc" } })).map((row) => row.threshold)).toEqual([80, 100]);
      expect(await ctx.prisma.auditLog.count({ where: { action: "ai.usage_threshold" } })).toBe(2);
      expect(await ctx.prisma.aiBudgetReservation.count()).toBe(0);

      // [#50] o SUPERADMIN aumenta o limite: a IA volta a atender os próximos.
      await adminAi({ monthlyLimitUsd: 5 });
      const after = newCustomer();
      await customerSays(after, "E agora?");
      expect(anthropic.requests).toHaveLength(4);
      expect((await conversationOf(after)).mode).toBe("AI");
    });

    it("[#49] renovação mensal: o gasto do mês anterior fica no histórico e não conta", async () => {
      await adminAi({ monthlyLimitUsd: 1 });
      const contact = await createContactRow(ctx.prisma, company.id);
      const conversation = await createConversationRow(ctx.prisma, company.id, contact.id);
      const lastMonth = new Date();
      lastMonth.setUTCDate(1);
      lastMonth.setUTCDate(lastMonth.getUTCDate() - 3);
      await ctx.prisma.aiRun.create({
        data: { id: crypto.randomUUID(), companyId: company.id, conversationId: conversation.id, model: "claude-sonnet-5-5", result: "REPLIED", messageCount: 1, costUsd: "50", apiSource: "SIMULATED", createdAt: lastMonth },
      });
      expect((await statusAs(superadmin)).budget).toMatchObject({ spentUsd: "0.000000", level: "OK" });
      await customerSays(newCustomer());
      expect(anthropic.requests).toHaveLength(1);
      expect(await ctx.prisma.aiRun.count()).toBe(2);
    });

    it("[#52] custo oficial, simulado e não verificado nunca se misturam: o bloqueio usa só a origem deste servidor", async () => {
      await adminAi({ monthlyLimitUsd: 1 });
      const contact = await createContactRow(ctx.prisma, company.id);
      const conversation = await createConversationRow(ctx.prisma, company.id, contact.id);
      const run = (apiSource: "OFFICIAL" | null, costUsd: string) =>
        ctx.prisma.aiRun.create({
          data: { id: crypto.randomUUID(), companyId: company.id, conversationId: conversation.id, model: "claude-sonnet-5-5", result: "REPLIED", messageCount: 1, costUsd, apiSource },
        });
      await run("OFFICIAL", "30");
      await run(null, "40");
      const view = (await statusAs(superadmin)).budget;
      expect(view?.enforcedSource).toBe("SIMULATED");
      expect(view?.spentUsd).toBe("0.000000");
      expect(view?.bySource).toEqual([
        { source: "OFFICIAL", spentUsd: "30.000000", runs: 1 },
        { source: "SIMULATED", spentUsd: "0.000000", runs: 0 },
        { source: "UNVERIFIED", spentUsd: "40.000000", runs: 1 },
      ]);
      await customerSays(newCustomer());
      expect(anthropic.requests).toHaveLength(1);
      expect(await ctx.prisma.aiRun.findFirstOrThrow({ where: { apiSource: "SIMULATED" } })).toMatchObject({ result: "REPLIED" });
    });

    it("[#67 #68] estado da Anthropic: simulador identificado; sucesso no simulador nunca conta como validação oficial", async () => {
      await customerSays(newCustomer());
      const body = (await as(ctx, superadmin).get("/admin/platform-settings")).body as AdminPlatformSettingsResponse;
      expect(body.integrations.anthropic).toMatchObject({ configured: true, environment: "SIMULATED", model: "claude-sonnet-5-5", companiesEnabled: 1, lastOfficialSuccessAt: null });
      expect(body.integrations.anthropic.lastSimulatedSuccessAt).not.toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/sk-ant|SIMULADO-0123/);
    });

    it("[#51] execuções simultâneas: as reservas nunca deixam passar mais do que o limite comporta", async () => {
      await adminAi({ monthlyLimitUsd: 1 });
      const budget = ctx.app.get(AiBudgetService);
      const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
      const decisions = await Promise.all(ids.map((id) => budget.reserve(company, id, "0.30")));
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
      expect(decisions.filter((decision) => !decision.allowed)).toEqual(Array(3).fill({ allowed: false, reason: "LIMIT_REACHED" }));
      expect(await ctx.prisma.aiBudgetReservation.count()).toBe(3);
      // Reserva vencida (API caiu no meio) deixa de contar sozinha.
      await ctx.prisma.aiBudgetReservation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await budget.reserve(company, crypto.randomUUID(), "0.90")).allowed).toBe(true);
      // Sem limite: nada é reservado.
      await adminAi({ monthlyLimitUsd: null });
      expect(await budget.reserve(company, crypto.randomUUID(), "999")).toEqual({ allowed: true });
    });
  });
});
