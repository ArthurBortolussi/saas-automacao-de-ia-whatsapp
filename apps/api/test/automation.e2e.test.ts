import type { Company, Conversation } from "@arthur-ai/database";
import {
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_WELCOME_MESSAGE,
  localDateTime,
  type CompanyAlertsResponse,
  type ConversationSummary,
  type Paginated,
} from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WebhookProcessorService } from "../src/whatsapp/webhook-processor.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi, replyText } from "./ai-helpers.js";
import { createCompany, createTestApp, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE = "888888888888888";
const SP = "America/Sao_Paulo";
const WELCOME = "Olá! Bem-vindo à Clínica A.";
const AFTER_HOURS = "Estamos fechados agora; respondemos no próximo expediente.";
const CLOSING = "Atendimento finalizado. Obrigado!";
const QUEUE = "Você está na fila; já vamos atender.";

let customerSequence = 0;
const newCustomer = () => `55119${String(20_000_000 + (customerSequence += 1)).slice(-8)}`;
const hhmm = (date: Date, timeZone = SP) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

describe("Fase 7 — mensagens automáticas, expediente da equipe e alertas da fila", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let anthropic: MockAnthropicApi;
  let restore: (() => void)[] = [];
  let whatsapp: WhatsAppWorker;
  let ai: AiWorker;
  let team: TeamWorker;
  let company: Company;
  let owner: MemberHandle;

  const settle = async () => {
    await whatsapp.drain();
    await ai.drain();
    await team.drain();
    await whatsapp.drain();
  };
  const customerSays = async (from: string, text = "Olá", options: { timestamp?: number } = {}) => {
    const response = await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE, from, text, wamid: nextWamid("wamid.IN"), ...options }));
    expect(response.status).toBe(200);
    await settle();
  };
  const conversationOf = (from: string): Promise<Conversation> => ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  const sentTexts = () =>
    graph.messageRequests().map((request) => (request.body as { text?: { body?: string } }).text?.body ?? "");
  const systemMessages = (conversationId: string) =>
    ctx.prisma.message.findMany({ where: { conversationId, senderType: "SYSTEM" }, orderBy: { id: "asc" } });
  const patchSettings = (path: string, body: object) => as(ctx, owner.cookie).patch(`/companies/${company.id}/settings/${path}`, body);
  const today = () => localDateTime(new Date(), SP).date;
  const closeToday = (kind: "business" | "ai" | "team") =>
    as(ctx, owner.cookie).post(`/companies/${company.id}/settings/exceptions`, {
      date: today(),
      label: "Fechado hoje",
      business: { mode: kind === "business" ? "CLOSED" : "DEFAULT" },
      ai: { mode: kind === "ai" ? "CLOSED" : "DEFAULT" },
      team: { mode: kind === "team" ? "CLOSED" : "DEFAULT" },
    });
  const humanByDefault = () =>
    ctx.prisma.aiSettings.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, defaultConversationMode: "HUMAN" },
      update: { defaultConversationMode: "HUMAN" },
    });
  const businessAlwaysOpen = () => patchSettings("schedules", { business: { alwaysOn: true, days: [], start: "08:00", end: "18:00" } });

  beforeAll(async () => {
    graph = new MockGraphApi();
    anthropic = new MockAnthropicApi();
    await graph.start();
    await anthropic.start();
    restore = [enableWhatsAppEnv(graph.url), enableAiEnv(anthropic.url)];
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
  });

  describe("[#21 #22] boas-vindas", () => {
    it("só no primeiro contato do cliente; não repete em novas mensagens nem na reabertura", async () => {
      await patchSettings("messages", { welcomeEnabled: true, welcomeMessage: WELCOME });
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { queueNoticeEnabled: false });
      const customer = newCustomer();
      await customerSays(customer, "Oi");
      const conversation = await conversationOf(customer);
      expect((await systemMessages(conversation.id)).map((message) => message.body)).toEqual([WELCOME]);
      expect(sentTexts()).toEqual([WELCOME]);
      await customerSays(customer, "Tudo bem?");
      // Encerrada e reaberta pelo cliente: novo ciclo, mas não é o primeiro contato.
      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE" });
      await team.drain();
      expect((await as(ctx, agent.cookie).post(`/companies/${company.id}/conversations/${conversation.id}/close`)).status).toBe(200);
      await customerSays(customer, "Voltei");
      expect(sentTexts().filter((text) => text === WELCOME)).toHaveLength(1);
      expect(await ctx.prisma.conversationCycle.count({ where: { conversationId: conversation.id } })).toBe(2);
    });

    it("cliente que já tinha escrito antes da Fase 7 não recebe boas-vindas (migração marcou o primeiro contato)", async () => {
      await businessAlwaysOpen();
      const customer = newCustomer();
      await customerSays(customer, "Mensagem antiga");
      await patchSettings("messages", { welcomeEnabled: true });
      await customerSays(customer, "Nova mensagem");
      expect(sentTexts()).not.toContain(DEFAULT_WELCOME_MESSAGE);
    });

    it("[#32] webhooks simultâneos do primeiro contato geram UMA boas-vindas (a transação perdedora é refeita sem repetir)", async () => {
      await patchSettings("messages", { welcomeEnabled: true });
      await businessAlwaysOpen();
      const processor = ctx.app.get(WebhookProcessorService);
      const customer = newCustomer();
      const first = inboundPayload({ phoneNumberId: PHONE, from: customer, text: "a", wamid: nextWamid("wamid.IN") });
      const second = inboundPayload({ phoneNumberId: PHONE, from: customer, text: "b", wamid: nextWamid("wamid.IN") });
      const duplicate = structuredClone(first);
      const results = await Promise.allSettled([processor.process(first), processor.process(second), processor.process(duplicate)]);
      // Quem perdeu a corrida (contato criado ao mesmo tempo) é reprocessado, como o worker faria.
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") await processor.process([first, second, duplicate][index]);
      }
      await settle();
      const conversation = await conversationOf(customer);
      expect(await ctx.prisma.message.count({ where: { conversationId: conversation.id, direction: "INBOUND" } })).toBe(2);
      expect((await systemMessages(conversation.id)).filter((message) => message.body === DEFAULT_WELCOME_MESSAGE)).toHaveLength(1);
    });
  });

  describe("[#24–#28 #9 #10] fora do expediente (horário GERAL do negócio)", () => {
    it("[#24 #25 #26] primeiro contato fechado: boas-vindas e depois o aviso, mesmo com a IA respondendo", async () => {
      await patchSettings("messages", { welcomeEnabled: true, welcomeMessage: WELCOME, afterHoursEnabled: true, afterHoursMessage: AFTER_HOURS });
      expect((await closeToday("business")).status).toBe(201);
      await ctx.prisma.aiSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, enabled: true }, update: { enabled: true } });
      anthropic.respondWith(() => replyText("Oi! Sou a assistente. Como posso ajudar?"));
      const customer = newCustomer();
      await customerSays(customer, "Vocês estão abertos?");
      expect(sentTexts()).toEqual([WELCOME, AFTER_HOURS, "Oi! Sou a assistente. Como posso ajudar?"]);
      const conversation = await conversationOf(customer);
      expect(conversation.mode).toBe("AI");
      const kinds = await ctx.prisma.message.findMany({ where: { conversationId: conversation.id, direction: "OUTBOUND" }, orderBy: { id: "asc" }, select: { senderType: true } });
      expect(kinds.map((row) => row.senderType)).toEqual(["SYSTEM", "SYSTEM", "AI"]);
    });

    it("[#27] várias mensagens no mesmo período fechado: um único aviso", async () => {
      await patchSettings("messages", { afterHoursEnabled: true, afterHoursMessage: AFTER_HOURS });
      await closeToday("business");
      const customer = newCustomer();
      await customerSays(customer, "Oi");
      await customerSays(customer, "Alguém?");
      await customerSays(customer, "???");
      expect(sentTexts().filter((text) => text === AFTER_HOURS)).toHaveLength(1);
    });

    it("[#28] novo período fechado (a empresa abriu e fechou de novo): novo aviso", async () => {
      await patchSettings("messages", { afterHoursEnabled: true, afterHoursMessage: AFTER_HOURS });
      // Todos os dias abre só entre 8 h e 7 h atrás (em UTC, para o teste não depender do dia da semana).
      await patchSettings("schedules", {
        business: { alwaysOn: false, days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(new Date(Date.now() - 8 * 3_600_000), "UTC"), end: hhmm(new Date(Date.now() - 7 * 3_600_000), "UTC") },
      });
      await patchSettings("company", { timezone: "UTC" });
      const customer = newCustomer();
      const seconds = (hoursAgo: number) => Math.floor((Date.now() - hoursAgo * 3_600_000) / 1000);
      await customerSays(customer, "antes da abertura", { timestamp: seconds(10) });
      await customerSays(customer, "ainda antes", { timestamp: seconds(9) });
      expect(sentTexts().filter((text) => text === AFTER_HOURS)).toHaveLength(1);
      await customerSays(customer, "depois do fechamento", { timestamp: seconds(1) });
      expect(sentTexts().filter((text) => text === AFTER_HOURS)).toHaveLength(2);
    });

    it("[#9 #10] usa o horário geral, não o da IA nem o da equipe; dentro do horário geral não avisa", async () => {
      await patchSettings("messages", { afterHoursEnabled: true });
      await businessAlwaysOpen();
      await closeToday("team");
      await patchSettings("schedules", { ai: { alwaysOn: false, days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(new Date(Date.now() + 6 * 3_600_000)), end: hhmm(new Date(Date.now() + 7 * 3_600_000)) } });
      await ctx.prisma.aiSettings.update({ where: { companyId: company.id }, data: { enabled: true } });
      const customer = newCustomer();
      await customerSays(customer, "Olá");
      expect(sentTexts()).not.toContain(DEFAULT_AFTER_HOURS_MESSAGE);
      // A IA, fora do horário dela, não responde (independente do horário geral).
      expect(anthropic.requests).toHaveLength(0);
      expect(await ctx.prisma.aiReplyTask.findFirst({ where: { status: "SKIPPED" } })).toMatchObject({ outcome: "OUTSIDE_SCHEDULE" });
    });

    it("[#31] janela de 24h fechada (mensagem antiga entregue com atraso): nenhum aviso é enviado", async () => {
      await patchSettings("messages", { afterHoursEnabled: true, welcomeEnabled: true });
      await closeToday("business");
      const customer = newCustomer();
      await customerSays(customer, "mensagem atrasada", { timestamp: Math.floor((Date.now() - 25 * 3_600_000) / 1000) });
      expect(sentTexts()).toEqual([]);
      const conversation = await conversationOf(customer);
      expect(await systemMessages(conversation.id)).toEqual([]);
    });
  });

  describe("[#23] mensagem de espera e [#29 #30] encerramento", () => {
    it("[#23] espera na fila com o texto da empresa; mudar o texto depois não reenvia; desligada não envia", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { queueNoticeMessage: QUEUE });
      const customer = newCustomer();
      await customerSays(customer, "Quero falar com alguém");
      expect(sentTexts()).toEqual([QUEUE]);
      await patchSettings("messages", { queueNoticeMessage: "Texto novo" });
      await customerSays(customer, "Ainda esperando");
      await team.drain();
      expect(sentTexts()).toEqual([QUEUE]);
      await patchSettings("messages", { queueNoticeEnabled: false });
      const other = newCustomer();
      await customerSays(other, "Oi");
      expect(sentTexts()).toEqual([QUEUE]);
      expect((await conversationOf(other)).queueNoticeError).toBe("DISABLED");
    });

    it("não manda o aviso de fila logo depois do aviso de fora do expediente do mesmo período", async () => {
      await humanByDefault();
      await patchSettings("messages", { afterHoursEnabled: true, afterHoursMessage: AFTER_HOURS });
      await closeToday("business");
      const customer = newCustomer();
      await customerSays(customer, "Olá");
      expect(sentTexts()).toEqual([AFTER_HOURS]);
      expect((await conversationOf(customer)).queueNoticeError).toBe("AFTER_HOURS_NOTICE");
    });

    it("[#29] encerramento manual envia a mensagem (uma vez); [#30] encerramento por inatividade não envia", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { closingEnabled: true, closingMessage: CLOSING, queueNoticeEnabled: false });
      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE" });
      const first = newCustomer();
      await customerSays(first, "Preciso de ajuda");
      const conversation = await conversationOf(first);
      expect(conversation.assignedUserId).toBe(agent.id);
      const closed = await as(ctx, agent.cookie).post(`/companies/${company.id}/conversations/${conversation.id}/close`);
      expect(closed.status).toBe(200);
      expect((await as(ctx, agent.cookie).post(`/companies/${company.id}/conversations/${conversation.id}/close`)).status).toBe(409);
      await whatsapp.drain();
      expect(sentTexts()).toEqual([CLOSING]);
      expect((await systemMessages(conversation.id)).map((message) => message.body)).toEqual([CLOSING]);

      const second = newCustomer();
      await customerSays(second, "Oi");
      const idle = await conversationOf(second);
      await ctx.prisma.conversation.update({ where: { id: idle.id }, data: { lastActivityAt: new Date(Date.now() - 5 * 60 * 60_000) } });
      await team.drain();
      expect((await conversationOf(second)).closeReason).toBe("INACTIVITY");
      expect(sentTexts()).toEqual([CLOSING]);
    });

    it("[#31] encerramento com a janela de 24h fechada: nada é enviado e o motivo fica na auditoria", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { closingEnabled: true, queueNoticeEnabled: false });
      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      await customerSays(customer, "Oi");
      const conversation = await conversationOf(customer);
      await ctx.prisma.conversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
      graph.reset();
      expect((await as(ctx, agent.cookie).post(`/companies/${company.id}/conversations/${conversation.id}/close`)).status).toBe(200);
      expect(sentTexts()).toEqual([]);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "conversation.closed", entityId: conversation.id } });
      expect(audit?.metadata).toMatchObject({ reason: "MANUAL", closingMessage: "WINDOW_CLOSED" });
    });
  });

  describe("[#12–#15] expediente da equipe", () => {
    it("fora do expediente: não distribui novos, mantém os atribuídos; ao abrir, a fila é retomada sozinha", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { queueNoticeEnabled: false });
      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE" });
      const before = newCustomer();
      await customerSays(before, "Cheguei antes");
      expect((await conversationOf(before)).assignedUserId).toBe(agent.id);

      expect((await closeToday("team")).status).toBe(201);
      const after = newCustomer();
      await customerSays(after, "Cheguei depois do expediente");
      expect((await conversationOf(after)).status).toBe("QUEUED");
      // [#13] o atendimento em andamento continua com o funcionário.
      expect(await conversationOf(before)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
      expect((await as(ctx, agent.cookie).post(`/companies/${company.id}/conversations/${(await conversationOf(before)).id}/messages`, { body: "Continuo aqui" })).status).toBe(201);

      // [#14] o expediente "começa" (a exceção deixa de valer) sem ninguém mexer no painel: o worker distribui.
      await ctx.prisma.scheduleException.deleteMany({});
      await team.drain();
      expect(await conversationOf(after)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
    });

    it("[#15] dentro do expediente, a distribuição continua respeitando disponibilidade e capacidade", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      const away = await addMember(ctx, company.id, { availability: "AWAY" });
      const customer = newCustomer();
      await customerSays(customer, "Oi");
      expect((await conversationOf(customer)).status).toBe("QUEUED");
      await as(ctx, away.cookie).patch(`/companies/${company.id}/team/me/availability`, { availability: "AVAILABLE" });
      await team.drain();
      expect((await conversationOf(customer)).assignedUserId).toBe(away.id);
    });
  });

  describe("[#33–#37] espera excessiva na fila", () => {
    it("destaque na Inbox e contagem no painel; a posição e a distribuição não mudam; some ao atribuir", async () => {
      await businessAlwaysOpen();
      await humanByDefault();
      await patchSettings("messages", { queueNoticeEnabled: false });
      expect((await patchSettings("service", { maxQueueWaitMinutes: 5 })).status).toBe(200);
      const older = newCustomer();
      const newer = newCustomer();
      await customerSays(older, "Primeiro");
      await customerSays(newer, "Segundo");
      const olderConversation = await conversationOf(older);
      await ctx.prisma.conversation.update({ where: { id: olderConversation.id }, data: { queuedAt: new Date(Date.now() - 10 * 60_000) } });

      const list = (await as(ctx, owner.cookie).get(`/companies/${company.id}/conversations?filter=queued`)).body as Paginated<ConversationSummary>;
      expect(list.items.map((item) => [item.contact.phone, item.queueOverdue])).toEqual([
        [older, true],
        [newer, false],
      ]);
      const alerts = (await as(ctx, owner.cookie).get(`/companies/${company.id}/alerts`)).body as CompanyAlertsResponse;
      expect(alerts.queue).toEqual({ overdue: 1, waiting: 2, maxQueueWaitMinutes: 5 });
      expect(JSON.stringify(alerts)).not.toMatch(/usd|cost|token/i);
      const agentOnly = await addMember(ctx, company.id, { availability: "AWAY" });
      expect((await as(ctx, agentOnly.cookie).get(`/companies/${company.id}/alerts`)).status).toBe(403);
      expect((await conversationOf(older)).status).toBe("QUEUED");

      const agent = await addMember(ctx, company.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      await team.drain();
      expect((await conversationOf(older)).assignedUserId).toBe(agent.id);
      expect((await conversationOf(newer)).status).toBe("QUEUED");
      const afterAssign = (await as(ctx, owner.cookie).get(`/companies/${company.id}/alerts`)).body as CompanyAlertsResponse;
      expect(afterAssign.queue.overdue).toBe(0);
      const detail = (await as(ctx, owner.cookie).get(`/companies/${company.id}/conversations/${olderConversation.id}`)).body as ConversationSummary;
      expect(detail.queueOverdue).toBe(false);
    });
  });
});
