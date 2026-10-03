import type { Company, Conversation } from "@arthur-ai/database";
import { API_ERROR_CODES, type CompanyDetail, type MeResponse, type SupportContacts } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WhatsAppOutboundService } from "../src/whatsapp/whatsapp-outbound.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi } from "./ai-helpers.js";
import { createCompany, createTestApp, createUser, login, PASSWORD, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE_A = "777777777777771";
const PHONE_B = "777777777777772";
let customerSequence = 0;
const newCustomer = () => `55119${String(40_000_000 + (customerSequence += 1)).slice(-8)}`;

describe("Fase 7 — suspensão e reativação de empresas", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let anthropic: MockAnthropicApi;
  let restore: (() => void)[] = [];
  let whatsapp: WhatsAppWorker;
  let ai: AiWorker;
  let team: TeamWorker;
  let companyA: Company;
  let companyB: Company;
  let owner: MemberHandle;
  let agent: MemberHandle;
  let ownerEmail: string;
  let superadmin: string;

  const settle = async () => {
    await whatsapp.drain();
    await ai.drain();
    await team.drain();
    await whatsapp.drain();
  };
  const customerSays = async (from: string, text = "Olá", phone = PHONE_A) => {
    expect((await postWebhook(ctx, inboundPayload({ phoneNumberId: phone, from, text, wamid: nextWamid("wamid.IN") }))).status).toBe(200);
    await settle();
  };
  const conversationOf = (from: string): Promise<Conversation> => ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  const suspend = (target = companyA) => as(ctx, superadmin).post(`/admin/companies/${target.id}/suspend`, { confirm: true });
  const reactivate = (target = companyA) => as(ctx, superadmin).post(`/admin/companies/${target.id}/reactivate`, { confirm: true });
  const counts = async () => ({
    contacts: await ctx.prisma.contact.count({ where: { companyId: companyA.id } }),
    conversations: await ctx.prisma.conversation.count({ where: { companyId: companyA.id } }),
    messages: await ctx.prisma.message.count({ where: { companyId: companyA.id } }),
    members: await ctx.prisma.companyMember.count({ where: { companyId: companyA.id } }),
    cycles: await ctx.prisma.conversationCycle.count({ where: { companyId: companyA.id } }),
    knowledge: await ctx.prisma.knowledgeEntry.count({ where: { companyId: companyA.id } }),
  });

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
    companyA = await createCompany(ctx.prisma, { name: "Clínica A" });
    companyB = await createCompany(ctx.prisma, { name: "Loja B" });
    await createAccountRow(ctx.prisma, companyA.id, PHONE_A);
    await createAccountRow(ctx.prisma, companyB.id, PHONE_B);
    owner = await addMember(ctx, companyA.id, { role: "OWNER" });
    ownerEmail = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email;
    agent = await addMember(ctx, companyA.id, { availability: "AWAY" });
    superadmin = await login(ctx.http, (await createUser(ctx.prisma, { globalRole: "SUPERADMIN" })).email);
    await ctx.prisma.aiSettings.create({ data: { companyId: companyA.id, enabled: true } });
    await ctx.prisma.knowledgeEntry.create({ data: { companyId: companyA.id, title: "Horário", content: "Abrimos às 8h." } });
  });

  it("[#54 #55 #62] suspensão completa: sessões encerradas, painel bloqueado e nenhum dado apagado", async () => {
    await customerSays(newCustomer(), "Olá");
    const before = await counts();
    expect((await as(ctx, agent.cookie).post(`/admin/companies/${companyA.id}/suspend`, { confirm: true })).status).toBe(403);
    const response = await suspend();
    expect(response.status).toBe(200);
    expect(response.body as CompanyDetail).toMatchObject({ status: "PAUSED" });
    expect((response.body as CompanyDetail).suspendedAt).not.toBeNull();
    expect((await suspend()).status).toBe(409);

    // Sessões já autenticadas deixam de valer.
    expect((await as(ctx, owner.cookie).get("/auth/me")).status).toBe(401);
    expect((await as(ctx, agent.cookie).get(`/companies/${companyA.id}/conversations`)).status).toBe(401);
    // Novo login funciona (para ver a tela de suspensão), mas nenhuma rota da empresa responde.
    const fresh = await login(ctx.http, ownerEmail, PASSWORD);
    const me = (await as(ctx, fresh).get("/auth/me")).body as MeResponse;
    expect(me.membership?.company.status).toBe("PAUSED");
    for (const path of ["", "/conversations", "/settings", "/ai", "/team", "/analytics", "/contacts", "/alerts"]) {
      const blocked = await as(ctx, fresh).get(`/companies/${companyA.id}${path}`);
      expect(blocked.status).toBe(403);
      expect((blocked.body as { code?: string }).code).toBe(API_ERROR_CODES.COMPANY_SUSPENDED);
    }
    expect((await as(ctx, fresh).patch(`/companies/${companyA.id}/settings/messages`, { welcomeEnabled: true })).status).toBe(403);
    // O SUPERADMIN continua consultando e administrando; outra empresa não é afetada.
    expect((await as(ctx, superadmin).get(`/companies/${companyA.id}/conversations`)).status).toBe(200);
    expect((await as(ctx, superadmin).get(`/admin/companies/${companyA.id}`)).status).toBe(200);
    expect((await ctx.prisma.company.findUniqueOrThrow({ where: { id: companyB.id } })).status).toBe("ACTIVE");
    expect(await counts()).toEqual(before);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "company.suspended" } });
    expect(audit?.metadata).toMatchObject({ previousStatus: "ACTIVE", revokedSessions: 2, confirmed: true });
  });

  it("[#56 #57 #58] durante a suspensão: sem IA, sem envios, sem distribuição", async () => {
    // Uma tarefa da IA pendente, uma mensagem na fila de envio e uma conversa aguardando na fila humana.
    const waitingAi = newCustomer();
    await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from: waitingAi, text: "Oi", wamid: nextWamid("wamid.IN") }));
    await whatsapp.drain();
    expect(await ctx.prisma.aiReplyTask.count({ where: { status: "PENDING" } })).toBe(1);
    const queuedConversation = await conversationOf(waitingAi);
    await ctx.prisma.conversation.update({ where: { id: queuedConversation.id }, data: { mode: "HUMAN", status: "QUEUED", queuedAt: new Date(), queueNoticeAt: new Date() } });
    const pending = await ctx.prisma.message.create({
      data: { companyId: companyA.id, conversationId: queuedConversation.id, direction: "OUTBOUND", senderType: "SYSTEM", body: "pendente", deliveryStatus: "PENDING", nextSendAttemptAt: new Date(Date.now() + 60_000) },
    });
    graph.reset();

    await suspend();
    expect(await ctx.prisma.aiReplyTask.findFirstOrThrow()).toMatchObject({ status: "CANCELED", outcome: "COMPANY_SUSPENDED" });
    expect(await ctx.prisma.message.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ deliveryStatus: "FAILED", errorCode: "COMPANY_SUSPENDED" });
    await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
    await ctx.prisma.companyMember.update({ where: { companyId_userId: { companyId: companyA.id, userId: agent.id } }, data: { availability: "AVAILABLE" } });
    await settle();
    expect(anthropic.requests).toHaveLength(0);
    expect(graph.messageRequests()).toHaveLength(0);
    expect((await conversationOf(waitingAi)).status).toBe("QUEUED");

    // Envio direto pelo serviço (ex.: uma tarefa que escapou) também é recusado na transação.
    const outbound = ctx.app.get(WhatsAppOutboundService);
    await expect(outbound.send(companyA, queuedConversation.id, "teste", { type: "SYSTEM" })).rejects.toThrow(/suspensa/);
    expect(graph.messageRequests()).toHaveLength(0);
  });

  it("[#59 #60 #61] webhooks na suspensão: descartados sem criar nada, nunca reprocessados após a reativação", async () => {
    const known = newCustomer();
    await customerSays(known, "Antes da suspensão");
    const before = await counts();
    await suspend();
    graph.reset();
    anthropic.reset();
    const stranger = newCustomer();
    await customerSays(stranger, "Mensagem durante a suspensão");
    await customerSays(known, "Cliente antigo escrevendo durante a suspensão");
    expect(await counts()).toEqual(before);
    expect(await ctx.prisma.contact.count({ where: { phone: stranger } })).toBe(0);
    const events = await ctx.prisma.whatsAppWebhookEvent.findMany({ where: { companyId: companyA.id }, orderBy: { receivedAt: "asc" } });
    expect(events.slice(-2).map((event) => [event.status, event.ignoredReason])).toEqual([
      ["IGNORED", "COMPANY_SUSPENDED"],
      ["IGNORED", "COMPANY_SUSPENDED"],
    ]);
    // A outra empresa continua recebendo normalmente.
    await customerSays(newCustomer(), "Loja B", PHONE_B);
    expect(await ctx.prisma.message.count({ where: { companyId: companyB.id } })).toBeGreaterThan(0);

    expect((await reactivate()).status).toBe(200);
    await settle();
    expect(await counts()).toEqual(before);
    expect(anthropic.requests).toHaveLength(0);
    expect(graph.messageRequests().filter((request) => JSON.stringify(request.body).includes(stranger))).toHaveLength(0);
  });

  it("[#63 #64] reativação pelo SUPERADMIN: acesso, recebimento e fila voltam; nada é encerrado por causa do tempo suspenso", async () => {
    const customer = newCustomer();
    await customerSays(customer, "Oi");
    const conversation = await conversationOf(customer);
    expect(conversation).toMatchObject({ mode: "AI", status: "OPEN" });
    await ctx.prisma.company.update({ where: { id: companyA.id }, data: { status: "ONBOARDING" } });
    await suspend();
    // Ficou suspensa por muito tempo (mais que o prazo de inatividade da IA).
    await ctx.prisma.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date(Date.now() - 48 * 3_600_000) } });
    await settle();
    expect((await conversationOf(customer)).status).toBe("OPEN");

    // A sessão antiga foi encerrada na suspensão; mesmo com um login novo, a empresa não se reativa sozinha.
    expect((await as(ctx, owner.cookie).post(`/admin/companies/${companyA.id}/reactivate`, { confirm: true })).status).toBe(401);
    const relogged = await login(ctx.http, ownerEmail, PASSWORD);
    expect((await as(ctx, relogged).post(`/admin/companies/${companyA.id}/reactivate`, { confirm: true })).status).toBe(403);
    const response = await reactivate();
    expect(response.status).toBe(200);
    expect(response.body as CompanyDetail).toMatchObject({ status: "ONBOARDING", suspendedAt: null });
    expect((await reactivate()).status).toBe(409);
    await settle();
    // O prazo recomeça na reativação: a conversa preservada não é encerrada de imediato.
    expect((await conversationOf(customer)).status).toBe("OPEN");

    const fresh = await login(ctx.http, ownerEmail, PASSWORD);
    expect((await as(ctx, fresh).get(`/companies/${companyA.id}/conversations`)).status).toBe(200);
    anthropic.reset();
    await customerSays(customer, "Voltei depois da reativação");
    expect(anthropic.requests).toHaveLength(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: "company.reactivated", companyId: companyA.id } })).toBe(1);
  });

  it("[#65] tela de suspensão: o usuário da empresa suspensa consulta os contatos de suporte (sem nada interno)", async () => {
    await as(ctx, superadmin).patch("/admin/platform-settings", { supportEmail: "suporte@arthur.ai", supportWhatsapp: "11977776666" });
    await suspend();
    const fresh = await login(ctx.http, ownerEmail, PASSWORD);
    const contacts = (await as(ctx, fresh).get("/support")).body as SupportContacts;
    expect(contacts).toEqual({
      email: "suporte@arthur.ai",
      whatsapp: "5511977776666",
      emailUrl: "mailto:suporte@arthur.ai",
      whatsappUrl: "https://wa.me/5511977776666",
    });
  });
});
