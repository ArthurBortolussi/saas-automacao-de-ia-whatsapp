import type { Company, Conversation } from "@arthur-ai/database";
import type { AiStatusResponse, CompanyAnalyticsReport } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { DistributionService } from "../src/team/distribution.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi, replyText } from "./ai-helpers.js";
import { createCompany, createTestApp, createUser, login, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE_A = "999999999999991";
const PHONE_B = "999999999999992";
const MINUTE = 60_000;

let customerSequence = 0;
const newCustomer = () => `55319${String(10_000_000 + (customerSequence += 1)).slice(-8)}`;

describe("Encerramento automático por inatividade dos atendimentos da IA", () => {
  let graph: MockGraphApi;
  let anthropic: MockAnthropicApi;
  let restore: (() => void)[] = [];
  let ctx: TestContext;
  let whatsapp: WhatsAppWorker;
  let ai: AiWorker;
  let team: TeamWorker;
  let distribution: DistributionService;
  let companyA: Company;
  let companyB: Company;
  let owner: MemberHandle;

  const settle = async () => {
    await whatsapp.drain();
    await ai.drain();
    await team.drain();
  };
  const customerSays = async (from: string, text = "Olá", phoneNumberId = PHONE_A) => {
    const response = await postWebhook(ctx, inboundPayload({ phoneNumberId, from, wamid: nextWamid("wamid.IN"), text }));
    expect(response.status).toBe(200);
    await settle();
  };
  const conversationOf = (from: string): Promise<Conversation> => ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  /** Simula a passagem do tempo: a última atividade fica N minutos no passado. */
  const idleFor = (conversation: { id: string }, minutes: number) =>
    ctx.prisma.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date(Date.now() - minutes * MINUTE) } });
  const enableAi = (company: Company, data: { inactivityTimeoutMinutes?: number; defaultConversationMode?: "AI" | "HUMAN" } = {}) =>
    ctx.prisma.aiSettings.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, enabled: true, ...data },
      update: { enabled: true, ...data },
    });
  /** Conversa em modo IA já respondida (fluxo real: webhook → IA simulada → envio). */
  const aiConversation = async (phoneNumberId = PHONE_A) => {
    const from = newCustomer();
    await customerSays(from, "Qual o horário?", phoneNumberId);
    const conversation = await conversationOf(from);
    expect(conversation).toMatchObject({ mode: "AI", status: "OPEN" });
    return { from, conversation };
  };
  const companyReport = async (): Promise<CompanyAnalyticsReport> => {
    const response = await as(ctx, owner.cookie).get(`/companies/${companyA.id}/analytics?period=last7days`);
    expect(response.status).toBe(200);
    return response.body as CompanyAnalyticsReport;
  };

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
    distribution = ctx.app.get(DistributionService);
  });

  beforeEach(async () => {
    await settle();
    await resetDatabase(ctx.prisma);
    graph.reset();
    anthropic.reset();
    anthropic.respondWith(() => replyText("Atendemos das 8h às 18h."));
    companyA = await createCompany(ctx.prisma, { name: "Clínica Prazo" });
    companyB = await createCompany(ctx.prisma, { name: "Loja Prazo" });
    await createAccountRow(ctx.prisma, companyA.id, PHONE_A);
    await createAccountRow(ctx.prisma, companyB.id, PHONE_B);
    owner = await addMember(ctx, companyA.id, { role: "OWNER" });
  });

  afterAll(async () => {
    await settle();
    await ctx.app.close();
    await graph.stop();
    await anthropic.stop();
    for (const fn of restore.reverse()) fn();
  });

  it("[1] prazo padrão de 4 horas: 3h59 continua aberto, 4h01 é encerrado", async () => {
    // Sem linha de AiSettings: valores padrão (a IA nem responde, mas a conversa nasce no modo IA).
    const status = (await as(ctx, owner.cookie).get(`/companies/${companyA.id}/ai`)).body as AiStatusResponse;
    expect(status.settings.inactivityTimeoutMinutes).toBe(240);
    const recent = newCustomer();
    const old = newCustomer();
    await customerSays(recent);
    await customerSays(old);
    await idleFor(await conversationOf(recent), 239);
    await idleFor(await conversationOf(old), 241);

    expect(await distribution.closeInactiveAi()).toBe(1);
    expect(await conversationOf(recent)).toMatchObject({ status: "OPEN", mode: "AI" });
    expect(await conversationOf(old)).toMatchObject({ status: "CLOSED", closeReason: "INACTIVITY", closedByUserId: null });
  });

  it("[2] proprietário e administrador alteram o prazo; funcionário e valores fora do limite são recusados", async () => {
    const admin = await addMember(ctx, companyA.id, { role: "ADMIN" });
    const agent = await addMember(ctx, companyA.id, { role: "AGENT" });
    const path = `/companies/${companyA.id}/ai/settings`;
    expect((await as(ctx, owner.cookie).patch(path, { inactivityTimeoutMinutes: 30 })).status).toBe(200);
    const byAdmin = await as(ctx, admin.cookie).patch(path, { inactivityTimeoutMinutes: 45 });
    expect(byAdmin.status).toBe(200);
    expect((byAdmin.body as AiStatusResponse).settings.inactivityTimeoutMinutes).toBe(45);
    expect((await as(ctx, agent.cookie).patch(path, { inactivityTimeoutMinutes: 10 })).status).toBe(403);
    expect((await as(ctx, owner.cookie).patch(path, { inactivityTimeoutMinutes: 4 })).status).toBe(400);
    expect((await as(ctx, owner.cookie).patch(path, { inactivityTimeoutMinutes: 43_201 })).status).toBe(400);
    expect((await as(ctx, owner.cookie).patch(path, { inactivityTimeoutMinutes: 12.5 })).status).toBe(400);
    const superadmin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    const superCookie = await login(ctx.http, superadmin.email);
    expect((await as(ctx, superCookie).patch(`/admin/companies/${companyA.id}/ai/settings`, { inactivityTimeoutMinutes: 60 })).status).toBe(200);
    expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: companyA.id } })).inactivityTimeoutMinutes).toBe(60);
    expect(await ctx.prisma.auditLog.count({ where: { action: "ai.settings_updated", companyId: companyA.id } })).toBe(3);

    // O prazo novo vale no encerramento: 61 minutos parado já encerra.
    await enableAi(companyA);
    const { conversation } = await aiConversation();
    await idleFor(conversation, 61);
    expect(await distribution.closeInactiveAi()).toBe(1);
  });

  it("[3] cada empresa usa o próprio prazo; ninguém altera o de outra empresa", async () => {
    await enableAi(companyA, { inactivityTimeoutMinutes: 30 });
    await enableAi(companyB);
    const a = await aiConversation(PHONE_A);
    const b = await aiConversation(PHONE_B);
    await idleFor(a.conversation, 60);
    await idleFor(b.conversation, 60);
    expect(await distribution.closeInactiveAi()).toBe(1);
    expect((await conversationOf(a.from)).status).toBe("CLOSED");
    expect((await conversationOf(b.from)).status).toBe("OPEN"); // B: 4 h

    expect((await as(ctx, owner.cookie).patch(`/companies/${companyB.id}/ai/settings`, { inactivityTimeoutMinutes: 5 })).status).toBe(403);
    expect((await ctx.prisma.aiSettings.findUniqueOrThrow({ where: { companyId: companyB.id } })).inactivityTimeoutMinutes).toBe(240);
  });

  it("[4] encerra pelo worker (sem navegador): conversa, ciclo e auditoria", async () => {
    await enableAi(companyA);
    const { from, conversation } = await aiConversation();
    await idleFor(conversation, 300);
    await team.drain(); // o mesmo worker periódico da equipe

    const closed = await conversationOf(from);
    expect(closed).toMatchObject({ status: "CLOSED", closeReason: "INACTIVITY", mode: "AI", assignedUserId: null });
    expect(closed.closedAt).not.toBeNull();
    // Horário real do encerramento (agora), nunca retroativo à última atividade.
    expect(Date.now() - (closed.closedAt?.getTime() ?? 0)).toBeLessThan(MINUTE);
    const cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
    expect(cycle).toMatchObject({ closeReason: "INACTIVITY" });
    expect(cycle.closedAt?.getTime()).toBe(closed.closedAt?.getTime());
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: "conversation.closed", entityId: conversation.id } });
    expect(audit.actorUserId).toBeNull();
    expect(audit.metadata).toMatchObject({ reason: "INACTIVITY", fromStatus: "OPEN" });
  });

  it("[5] conversas HUMANAS e PAUSADAS nunca são encerradas pelo prazo da IA", async () => {
    await enableAi(companyA, { inactivityTimeoutMinutes: 5 });
    const human = await aiConversation();
    const paused = await aiConversation();
    const agent = await addMember(ctx, companyA.id, { role: "AGENT" });
    // Humano assumido (ASSIGNED) e conversa da IA pausada (OPEN + PAUSED).
    expect((await as(ctx, agent.cookie).post(`/companies/${companyA.id}/conversations/${human.conversation.id}/mode`, { action: "ASSUME" })).status).toBe(200);
    expect((await as(ctx, owner.cookie).post(`/companies/${companyA.id}/conversations/${paused.conversation.id}/mode`, { action: "PAUSE" })).status).toBe(200);
    await idleFor(human.conversation, 600);
    await idleFor(paused.conversation, 600);

    expect(await distribution.closeInactiveAi()).toBe(0);
    expect(await conversationOf(human.from)).toMatchObject({ mode: "HUMAN", status: "ASSIGNED" });
    expect(await conversationOf(paused.from)).toMatchObject({ mode: "PAUSED", status: "OPEN" });
  });

  it("[6] não encerra com tarefa da IA pendente ou mensagem sendo enviada", async () => {
    await enableAi(companyA);
    const { from, conversation } = await aiConversation();
    const message = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, senderType: "CONTACT" } });
    // Tarefa da IA ainda pendente (ex.: aguardando retentativa): a resposta ainda pode sair.
    await ctx.prisma.aiReplyTask.update({ where: { messageId: message.id }, data: { status: "PENDING", nextAttemptAt: new Date(Date.now() + 60 * MINUTE) } });
    await idleFor(conversation, 300);
    expect(await distribution.closeInactiveAi()).toBe(0);

    await ctx.prisma.aiReplyTask.update({ where: { messageId: message.id }, data: { status: "RUNNING" } });
    expect(await distribution.closeInactiveAi()).toBe(0);

    await ctx.prisma.aiReplyTask.update({ where: { messageId: message.id }, data: { status: "DONE" } });
    const reply = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, senderType: "AI" } });
    await ctx.prisma.message.update({ where: { id: reply.id }, data: { deliveryStatus: "PENDING", nextSendAttemptAt: new Date(Date.now() + 60 * MINUTE) } });
    expect(await distribution.closeInactiveAi()).toBe(0);
    expect((await conversationOf(from)).status).toBe("OPEN");

    await ctx.prisma.message.update({ where: { id: reply.id }, data: { deliveryStatus: "SENT" } });
    expect(await distribution.closeInactiveAi()).toBe(1);
  });

  it("[7] mensagem do cliente durante o encerramento: a gravação é reavaliada e nada é encerrado", async () => {
    await enableAi(companyA);
    const { from, conversation } = await aiConversation();
    await idleFor(conversation, 300);

    // Simula um webhook em andamento: trava a linha da conversa (como o FOR UPDATE do recebimento) e, com o
    // encerramento já esperando por ela, registra a nova atividade antes de soltar a trava.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const inbound = ctx.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversation.id}::uuid FOR UPDATE`;
      locked();
      await gate;
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date() } });
    });
    await lockTaken;
    const closing = distribution.closeInactiveAi();
    await new Promise((resolve) => setTimeout(resolve, 150)); // o encerramento fica bloqueado na trava da linha
    release();
    await inbound;
    expect(await closing).toBe(0);
    expect((await conversationOf(from)).status).toBe("OPEN");
    expect(await ctx.prisma.conversationCycle.count({ where: { conversationId: conversation.id, closedAt: null } })).toBe(1);

    // Corrida real (webhook × encerramento): o cliente sempre termina numa conversa aberta, com um ciclo aberto.
    await idleFor(conversation, 300);
    await Promise.all([
      distribution.closeInactiveAi(),
      postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from, wamid: nextWamid("wamid.IN"), text: "Ainda estou aqui" })),
    ]);
    await settle();
    const after = await conversationOf(from);
    expect(after.status).toBe("OPEN");
    expect(await ctx.prisma.conversationCycle.count({ where: { conversationId: conversation.id, closedAt: null } })).toBe(1);
  });

  it("[8] execuções simultâneas encerram cada atendimento uma única vez", async () => {
    await enableAi(companyA);
    const conversations = [await aiConversation(), await aiConversation(), await aiConversation()];
    for (const item of conversations) await idleFor(item.conversation, 300);
    const results = await Promise.all([distribution.closeInactiveAi(), distribution.closeInactiveAi(), distribution.closeInactiveAi(), team.drain().then(() => 0)]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(3);
    for (const item of conversations) {
      expect((await conversationOf(item.from)).status).toBe("CLOSED");
      expect(await ctx.prisma.auditLog.count({ where: { action: "conversation.closed", entityId: item.conversation.id } })).toBe(1);
      expect(await ctx.prisma.conversationCycle.count({ where: { conversationId: item.conversation.id } })).toBe(1);
    }
    expect(await distribution.closeInactiveAi()).toBe(0);
  });

  it("[9] cliente volta a escrever: reabre a mesma conversa no modo padrão da empresa, com histórico", async () => {
    await enableAi(companyA);
    const { from, conversation } = await aiConversation();
    await idleFor(conversation, 300);
    expect(await distribution.closeInactiveAi()).toBe(1);

    await customerSays(from, "Voltei, vocês abrem amanhã?");
    const reopened = await conversationOf(from);
    expect(reopened.id).toBe(conversation.id);
    expect(reopened).toMatchObject({ status: "OPEN", mode: "AI", closedAt: null, closeReason: null });
    expect(await ctx.prisma.message.count({ where: { conversationId: conversation.id, senderType: "AI" } })).toBe(2);
    expect(await ctx.prisma.message.count({ where: { conversationId: conversation.id, senderType: "CONTACT" } })).toBe(2);
    const cycles = await ctx.prisma.conversationCycle.findMany({ where: { conversationId: conversation.id }, orderBy: { startedAt: "asc" } });
    expect(cycles.map((cycle) => [cycle.origin, cycle.closeReason])).toEqual([
      ["NEW_CONVERSATION", "INACTIVITY"],
      ["REOPENED", null],
    ]);

    // Padrão humano: a reabertura vai para a fila da equipe.
    await enableAi(companyA, { defaultConversationMode: "HUMAN" });
    await idleFor(reopened, 300);
    expect(await distribution.closeInactiveAi()).toBe(1);
    await customerSays(from, "Quero falar com alguém");
    expect(await conversationOf(from)).toMatchObject({ status: "QUEUED", mode: "HUMAN" });
  });

  it("[10] Analytics: somente IA em andamento × encerrado por inatividade × com intervenção humana", async () => {
    await enableAi(companyA);
    const open = await aiConversation();
    const idle = await aiConversation();
    const helped = await aiConversation();
    const agent = await addMember(ctx, companyA.id, { role: "AGENT" });
    expect((await as(ctx, agent.cookie).post(`/companies/${companyA.id}/conversations/${helped.conversation.id}/mode`, { action: "ASSUME" })).status).toBe(200);
    await idleFor(idle.conversation, 300);
    await idleFor(open.conversation, 10);
    expect(await distribution.closeInactiveAi()).toBe(1);

    let report = await companyReport();
    expect(report.cycles).toMatchObject({ started: 3, aiOnlyOpen: 1, aiOnlyClosed: 1, aiOnlyClosedInactivity: 1, withHuman: 1 });
    expect(report.closed).toMatchObject({ total: 1, inactivity: 1, manual: 0, withHuman: 0 });
    expect(report.current).toMatchObject({ inProgress: 2, withAi: 1, withAgent: 1 });

    // Reaberto: o encerramento anterior continua contado e o novo atendimento aparece em andamento.
    await customerSays(idle.from, "Oi de novo");
    report = await companyReport();
    expect(report.cycles).toMatchObject({ started: 4, aiOnlyOpen: 2, aiOnlyClosedInactivity: 1, withHuman: 1 });
    expect(report.closed.inactivity).toBe(1);
  });
});
