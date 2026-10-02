import type { Company, Conversation } from "@arthur-ai/database";
import { QUEUE_WAITING_MESSAGE, type ConversationDetail, type EligibleAssignee } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { DistributionService } from "../src/team/distribution.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi, replyHandoff, replyText } from "./ai-helpers.js";
import { createCompany, createContactRow, createTestApp, resetDatabase, type TestContext } from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE_A = "666666666666666";
const PHONE_B = "777777777777777";

interface Harness {
  ctx: TestContext;
  whatsapp: WhatsAppWorker;
  ai: AiWorker;
  team: TeamWorker;
  distribution: DistributionService;
}

async function boot(): Promise<Harness> {
  const ctx = await createTestApp();
  return {
    ctx,
    whatsapp: ctx.app.get(WhatsAppWorker),
    ai: ctx.app.get(AiWorker),
    team: ctx.app.get(TeamWorker),
    distribution: ctx.app.get(DistributionService),
  };
}

let customerSequence = 0;
const newCustomer = () => `55119${String(10_000_000 + (customerSequence += 1)).slice(-8)}`;

describe("Atendimento humano: distribuição, fila, transferências e encerramentos", () => {
  let graph: MockGraphApi;
  let anthropic: MockAnthropicApi;
  let restore: (() => void)[] = [];
  let h: Harness;
  let companyA: Company;
  let companyB: Company;
  let owner: MemberHandle;

  /** Cliente escreve pelo WhatsApp e tudo o que está em segundo plano roda (fila do webhook, IA, equipe). */
  const customerSays = async (from: string, text = "Olá", phoneNumberId = PHONE_A) => {
    const response = await postWebhook(h.ctx, inboundPayload({ phoneNumberId, from, wamid: nextWamid("wamid.IN"), text }));
    expect(response.status).toBe(200);
    await settle();
  };
  const settle = async () => {
    await h.whatsapp.drain();
    await h.ai.drain();
    await h.team.drain();
  };
  const conversationOf = (from: string): Promise<Conversation> =>
    h.ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  const loadOf = (userId: string) => h.ctx.prisma.conversation.count({ where: { assignedUserId: userId, status: "ASSIGNED" } });
  const setAvailability = (member: MemberHandle, availability: string, company = companyA) =>
    as(h.ctx, member.cookie).patch(`/companies/${company.id}/team/me/availability`, { availability });
  const convPath = (conversation: { id: string }, company = companyA) => `/companies/${company.id}/conversations/${conversation.id}`;
  const queueNotices = () => graph.messageRequests().filter((request) => JSON.stringify(request.body).includes("todos os nossos atendentes"));
  const humanByDefault = (company: Company) =>
    h.ctx.prisma.aiSettings.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, defaultConversationMode: "HUMAN" },
      update: { defaultConversationMode: "HUMAN" },
    });

  beforeAll(async () => {
    graph = new MockGraphApi();
    anthropic = new MockAnthropicApi();
    await graph.start();
    await anthropic.start();
    restore = [enableWhatsAppEnv(graph.url), enableAiEnv(anthropic.url)];
    h = await boot();
  });

  beforeEach(async () => {
    await settle();
    await resetDatabase(h.ctx.prisma);
    graph.reset();
    anthropic.reset();
    companyA = await createCompany(h.ctx.prisma, { name: "Clínica A" });
    companyB = await createCompany(h.ctx.prisma, { name: "Loja B" });
    await createAccountRow(h.ctx.prisma, companyA.id, PHONE_A);
    await createAccountRow(h.ctx.prisma, companyB.id, PHONE_B);
    await humanByDefault(companyA);
    await humanByDefault(companyB);
    owner = await addMember(h.ctx, companyA.id, { role: "OWNER" });
  });

  afterAll(async () => {
    await settle();
    await h.ctx.app.close();
    await graph.stop();
    await anthropic.stop();
    for (const fn of restore.reverse()) fn();
  });

  describe("[#6 #7 #8 #9] distribuição automática", () => {
    it("[#6] atribui só a quem é da empresa, está ativo, pode atender, está disponível e tem vaga", async () => {
      await addMember(h.ctx, companyA.id, { availability: "BUSY" });
      await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", canAttend: false });
      const inactive = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      await h.ctx.prisma.user.update({ where: { id: inactive.id }, data: { status: "INACTIVE" } });
      await addMember(h.ctx, companyB.id, { availability: "AVAILABLE" });
      const right = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });

      const from = newCustomer();
      await customerSays(from, "Quero atendimento");
      const conversation = await conversationOf(from);
      expect(conversation).toMatchObject({ mode: "HUMAN", status: "ASSIGNED", assignedUserId: right.id, queuedAt: null });
      expect(conversation.assignedAt).not.toBeNull();
      expect(queueNotices()).toHaveLength(0);
      expect(await h.ctx.prisma.conversationAssignment.count({ where: { conversationId: conversation.id, userId: right.id, startReason: "AUTO" } })).toBe(1);
      expect(await h.ctx.prisma.auditLog.count({ where: { action: "conversation.assigned", entityId: conversation.id } })).toBe(1);
    });

    it("[#7] prioriza quem tem menos atendimentos", async () => {
      const busy = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const free = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const contact = await createContactRow(h.ctx.prisma, companyA.id);
      for (let index = 0; index < 2; index += 1) {
        await h.ctx.prisma.conversation.create({
          data: { companyId: companyA.id, contactId: contact.id, mode: "HUMAN", status: "ASSIGNED", assignedUserId: busy.id, assignedAt: new Date(), lastActivityAt: new Date() },
        });
      }
      const from = newCustomer();
      await customerSays(from);
      expect((await conversationOf(from)).assignedUserId).toBe(free.id);
    });

    it("[#8] desempate em rotação: ninguém é favorecido para sempre", async () => {
      const first = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const second = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const order: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const from = newCustomer();
        await customerSays(from);
        order.push((await conversationOf(from)).assignedUserId ?? "");
        // Mantém as cargas iguais para isolar o desempate: o atendimento recém-atribuído é finalizado.
        await as(h.ctx, owner.cookie).post(`${convPath(await conversationOf(from))}/close`);
      }
      expect(new Set(order)).toEqual(new Set([first.id, second.id]));
      expect(order[0]).not.toBe(order[1]);
      expect(order[1]).not.toBe(order[2]);
      expect(order[2]).not.toBe(order[3]);
    });

    it("[#9] respeita o limite individual: o excedente vai para a fila", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      const firstCustomer = newCustomer();
      const secondCustomer = newCustomer();
      await customerSays(firstCustomer);
      await customerSays(secondCustomer);
      expect((await conversationOf(firstCustomer)).assignedUserId).toBe(agent.id);
      expect(await conversationOf(secondCustomer)).toMatchObject({ status: "QUEUED", assignedUserId: null });
      expect(await loadOf(agent.id)).toBe(1);
    });
  });

  describe("[#10 #11 #12 #13] fila de espera", () => {
    it("[#10 #11] sem ninguém disponível: fila em ordem de chegada e aviso de espera pelo WhatsApp", async () => {
      const customers = [newCustomer(), newCustomer(), newCustomer()];
      for (const from of customers) await customerSays(from);
      const conversations = await Promise.all(customers.map(conversationOf));
      expect(conversations.every((conversation) => conversation.status === "QUEUED")).toBe(true);
      const positions = await Promise.all(
        conversations.map(async (conversation) => ((await as(h.ctx, owner.cookie).get(convPath(conversation))).body as ConversationDetail).queuePosition),
      );
      expect(positions).toEqual([1, 2, 3]);

      expect(queueNotices()).toHaveLength(3);
      const notice = await h.ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversations[0]?.id, direction: "OUTBOUND" } });
      expect(notice).toMatchObject({ senderType: "SYSTEM", body: QUEUE_WAITING_MESSAGE, deliveryStatus: "SENT" });
      expect((await conversationOf(customers[0] ?? "")).queueNoticeAt).not.toBeNull();
      expect(anthropic.requests).toHaveLength(0); // texto fixo: nada de IA
    });

    it("[#12] o aviso sai uma única vez por entrada na fila, mesmo com novas mensagens e ciclos repetidos", async () => {
      const from = newCustomer();
      await customerSays(from, "Oi");
      await customerSays(from, "Tem alguém?");
      await customerSays(from, "Alô");
      await h.team.drain();
      await Promise.all([h.distribution.sendQueueNotices(), h.distribution.sendQueueNotices()]);
      expect(queueNotices()).toHaveLength(1);
    });

    it("janela de 24h fechada ou conversa interna: continua na fila, sem envio proibido, com o motivo registrado", async () => {
      const from = newCustomer();
      await postWebhook(h.ctx, inboundPayload({ phoneNumberId: PHONE_A, from, text: "antiga", timestamp: Math.floor(Date.now() / 1000) - 25 * 3600 }));
      await settle();
      expect(await conversationOf(from)).toMatchObject({ status: "QUEUED", queueNoticeError: "WINDOW_CLOSED", queueNoticeAt: null });

      const contact = await createContactRow(h.ctx.prisma, companyA.id);
      const internal = await h.ctx.prisma.conversation.create({
        data: { companyId: companyA.id, contactId: contact.id, mode: "HUMAN", status: "QUEUED", queuedAt: new Date() },
      });
      await h.team.drain();
      expect(await h.ctx.prisma.conversation.findUniqueOrThrow({ where: { id: internal.id } })).toMatchObject({
        status: "QUEUED",
        queueNoticeError: "INTERNAL_CHANNEL",
      });
      expect(queueNotices()).toHaveLength(0);
    });

    it("[#13 #22] uma vaga liberada puxa a próxima da fila, na ordem de chegada", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      const [a, b, c] = [newCustomer(), newCustomer(), newCustomer()];
      await customerSays(a);
      await customerSays(b);
      await customerSays(c);
      expect((await conversationOf(a)).assignedUserId).toBe(agent.id);

      const closed = await as(h.ctx, agent.cookie).post(`${convPath(await conversationOf(a))}/close`);
      expect(closed.status).toBe(200);
      expect((closed.body as ConversationDetail).status).toBe("CLOSED");
      expect((await conversationOf(b)).assignedUserId).toBe(agent.id);
      expect((await conversationOf(c)).status).toBe("QUEUED");
      expect(await loadOf(agent.id)).toBe(1);
    });

    it("quem fica disponível recebe a fila na hora (e vários ficando disponíveis ao mesmo tempo não duplicam nada)", async () => {
      const agents = [await addMember(h.ctx, companyA.id), await addMember(h.ctx, companyA.id), await addMember(h.ctx, companyA.id)];
      const customers = [newCustomer(), newCustomer()];
      for (const from of customers) await customerSays(from);
      const results = await Promise.all(agents.map((agent) => setAvailability(agent, "AVAILABLE")));
      expect(results.every((result) => result.status === 200)).toBe(true);
      const assigned = await Promise.all(customers.map(conversationOf));
      expect(assigned.every((conversation) => conversation.status === "ASSIGNED")).toBe(true);
      expect(new Set(assigned.map((conversation) => conversation.assignedUserId)).size).toBe(2);
      expect(await h.ctx.prisma.conversationAssignment.count()).toBe(2);
    });
  });

  describe("[#14 #15] ocupado e ausente mantêm as conversas", () => {
    for (const state of ["BUSY", "AWAY"] as const) {
      it(`${state}: conversas atuais continuam com o funcionário; as novas não chegam a ele`, async () => {
        const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
        const kept = newCustomer();
        await customerSays(kept);
        expect((await setAvailability(agent, state)).status).toBe(200);
        const next = newCustomer();
        await customerSays(next);
        expect(await conversationOf(kept)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
        expect(await conversationOf(next)).toMatchObject({ status: "QUEUED", assignedUserId: null });
        // O funcionário continua respondendo a conversa dele.
        const reply = await as(h.ctx, agent.cookie).post(`${convPath(await conversationOf(kept))}/messages`, { body: "Já volto com a resposta." });
        expect(reply.status).toBe(201);
      });
    }
  });

  describe("[#16 #17 #18] transferências", () => {
    it("[#16] funcionário transfere a própria conversa: atômico, com histórico, e a vaga liberada puxa a fila", async () => {
      const from = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      // Limite 2: ao ficar disponível ele já recebe a conversa da fila e ainda precisa de vaga para a transferência.
      const to = await addMember(h.ctx, companyA.id, { availability: "BUSY", maxConcurrent: 2 });
      const [first, waiting] = [newCustomer(), newCustomer()];
      await customerSays(first, "Mensagem 1");
      await customerSays(waiting);
      const conversation = await conversationOf(first);
      expect(conversation.assignedUserId).toBe(from.id);
      await setAvailability(to, "AVAILABLE");

      const listed = (await as(h.ctx, from.cookie).get(`${convPath(conversation)}/assignees`)).body as EligibleAssignee[];
      expect(listed.map((item) => item.userId)).toContain(to.id);
      expect(listed.map((item) => item.userId)).not.toContain(from.id);

      const response = await as(h.ctx, from.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: to.id });
      expect(response.status).toBe(200);
      expect((response.body as ConversationDetail).assignedUser?.id).toBe(to.id);
      const history = await h.ctx.prisma.conversationAssignment.findMany({ where: { conversationId: conversation.id }, orderBy: { assignedAt: "asc" } });
      expect(history.map((row) => [row.userId, row.startReason, row.endReason])).toEqual([
        [from.id, "AUTO", "TRANSFERRED"],
        [to.id, "TRANSFER", null],
      ]);
      expect(await h.ctx.prisma.message.count({ where: { conversationId: conversation.id, body: "Mensagem 1" } })).toBe(1);
      expect(await h.ctx.prisma.auditLog.count({ where: { action: "conversation.transferred", entityId: conversation.id } })).toBe(1);
      // A conversa da fila foi para "to" quando ele ficou disponível; "from" ficou livre.
      expect((await conversationOf(waiting)).assignedUserId).toBe(to.id);
      expect(await loadOf(from.id)).toBe(0);
      // A vaga liberada por "from" puxa a próxima que chegar.
      const next = newCustomer();
      await customerSays(next);
      expect((await conversationOf(next)).assignedUserId).toBe(from.id);
    });

    it("[#17] transferir para usuário de outra empresa é recusado sem revelar nada", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const foreign = await addMember(h.ctx, companyB.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      await customerSays(customer);
      const conversation = await conversationOf(customer);
      const response = await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: foreign.id });
      expect(response.status).toBe(404);
      expect((await conversationOf(customer)).assignedUserId).toBe(agent.id);
      // Funcionário da B também não opera conversas da A.
      expect((await as(h.ctx, foreign.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: foreign.id })).status).toBe(403);
      expect((await as(h.ctx, foreign.cookie).post(`${convPath(conversation, companyB)}/transfer`, { toUserId: foreign.id })).status).toBe(404);
    });

    it("[#18] destinatário ocupado, sem vaga, sem permissão ou desativado; e conversa de outro colega", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const busy = await addMember(h.ctx, companyA.id, { availability: "BUSY" });
      const full = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      const noAttend = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", canAttend: false });
      const disabled = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      await h.ctx.prisma.user.update({ where: { id: disabled.id }, data: { status: "INACTIVE" } });
      const contact = await createContactRow(h.ctx.prisma, companyA.id);
      await h.ctx.prisma.conversation.create({
        data: { companyId: companyA.id, contactId: contact.id, mode: "HUMAN", status: "ASSIGNED", assignedUserId: full.id, assignedAt: new Date(), lastActivityAt: new Date() },
      });
      await h.ctx.prisma.companyMember.update({ where: { userId: agent.id }, data: { lastAssignedAt: new Date(0) } });
      const customer = newCustomer();
      await customerSays(customer);
      const conversation = await conversationOf(customer);
      expect(conversation.assignedUserId).toBe(agent.id);

      for (const target of [busy, full, noAttend, disabled]) {
        const response = await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: target.id });
        expect(response.status, target.email).toBe(409);
      }
      const other = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      expect((await as(h.ctx, other.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: other.id })).status).toBe(403);
      expect((await conversationOf(customer)).assignedUserId).toBe(agent.id);
      // Proprietário pode redistribuir qualquer conversa humana da empresa.
      expect((await as(h.ctx, owner.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: other.id })).status).toBe(200);
    });

    it("[#31] duas transferências simultâneas da mesma conversa: uma vence, nunca duas atribuições abertas", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const x = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const y = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      await h.ctx.prisma.companyMember.update({ where: { userId: agent.id }, data: { lastAssignedAt: new Date(0) } });
      await h.ctx.prisma.companyMember.updateMany({ where: { userId: { in: [x.id, y.id] } }, data: { lastAssignedAt: new Date() } });
      const customer = newCustomer();
      await customerSays(customer);
      const conversation = await conversationOf(customer);
      expect(conversation.assignedUserId).toBe(agent.id);
      const results = await Promise.all([
        as(h.ctx, agent.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: x.id }),
        as(h.ctx, agent.cookie).post(`${convPath(conversation)}/transfer`, { toUserId: y.id }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 403]);
      expect(await h.ctx.prisma.conversationAssignment.count({ where: { conversationId: conversation.id, endedAt: null } })).toBe(1);
    });
  });

  describe("[#19 #20 #21] encerramento", () => {
    it("[#19] manual: responsável ou administrador; libera a vaga e bloqueia novas ações no ciclo encerrado", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const other = await addMember(h.ctx, companyA.id, { availability: "BUSY" });
      const customer = newCustomer();
      await customerSays(customer);
      const conversation = await conversationOf(customer);
      expect((await as(h.ctx, other.cookie).post(`${convPath(conversation)}/close`)).status).toBe(403);
      const closed = await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/close`);
      expect(closed.status).toBe(200);
      expect(await conversationOf(customer)).toMatchObject({ status: "CLOSED", closeReason: "MANUAL", closedByUserId: agent.id, assignedUserId: null });
      expect(await loadOf(agent.id)).toBe(0);
      expect((await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/close`)).status).toBe(409);
      expect((await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/messages`, { body: "Oi" })).status).toBe(409);
      expect(await h.ctx.prisma.auditLog.count({ where: { action: "conversation.closed", entityId: conversation.id } })).toBe(1);

      // Administrador encerra atendimento de outra pessoa.
      const second = newCustomer();
      await customerSays(second);
      expect((await as(h.ctx, owner.cookie).post(`${convPath(await conversationOf(second))}/close`)).status).toBe(200);
    });

    it("[#20] automático por inatividade, em segundo plano, com o prazo da empresa", async () => {
      await h.ctx.prisma.teamSettings.create({ data: { companyId: companyA.id, inactivityTimeoutMinutes: 30 } });
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const [stale, fresh] = [newCustomer(), newCustomer()];
      await customerSays(stale);
      await customerSays(fresh);
      await h.ctx.prisma.conversation.update({ where: { id: (await conversationOf(stale)).id }, data: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
      await h.ctx.prisma.conversation.update({ where: { id: (await conversationOf(fresh)).id }, data: { lastActivityAt: new Date(Date.now() - 29 * 60_000) } });
      await h.team.drain();
      expect(await conversationOf(stale)).toMatchObject({ status: "CLOSED", closeReason: "INACTIVITY", closedByUserId: null });
      expect(await conversationOf(fresh)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
    });

    it("[#21] não encerra com envio em andamento nem quando chega mensagem durante o encerramento", async () => {
      await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const sending = newCustomer();
      await customerSays(sending);
      const conversation = await conversationOf(sending);
      await h.ctx.prisma.message.create({
        data: { companyId: companyA.id, conversationId: conversation.id, direction: "OUTBOUND", senderType: "AGENT", body: "em envio", deliveryStatus: "PENDING", nextSendAttemptAt: new Date(Date.now() + 3600_000) },
      });
      await h.ctx.prisma.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date(Date.now() - 10 * 3600_000) } });
      await h.team.drain();
      expect((await conversationOf(sending)).status).toBe("ASSIGNED");

      // Corrida real: encerramento e mensagem nova ao mesmo tempo. Seja qual for a ordem, o cliente não fica
      // numa conversa encerrada: ou o encerramento perde, ou a mensagem reabre o atendimento.
      const racing = newCustomer();
      await customerSays(racing);
      const raced = await conversationOf(racing);
      await h.ctx.prisma.conversation.update({ where: { id: raced.id }, data: { lastActivityAt: new Date(Date.now() - 10 * 3600_000) } });
      await Promise.all([
        h.distribution.closeInactive(),
        postWebhook(h.ctx, inboundPayload({ phoneNumberId: PHONE_A, from: racing, wamid: nextWamid("wamid.IN"), text: "Ainda estou aqui" })).then(() => h.whatsapp.drain()),
      ]);
      await settle();
      expect((await conversationOf(racing)).status).not.toBe("CLOSED");
    });
  });

  describe("[#23 #24 #25] reabertura", () => {
    it("[#23 #25] padrão IA: reabre a MESMA conversa no modo IA, sem o responsável antigo, e a IA responde", async () => {
      await h.ctx.prisma.aiSettings.update({ where: { companyId: companyA.id }, data: { defaultConversationMode: "AI", enabled: true } });
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      const contact = await h.ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Cliente", phone: customer, whatsappId: customer } });
      const conversation = await h.ctx.prisma.conversation.create({
        data: { companyId: companyA.id, contactId: contact.id, channel: "WHATSAPP", mode: "HUMAN", status: "ASSIGNED", assignedUserId: agent.id, assignedAt: new Date(), lastActivityAt: new Date() },
      });
      await h.ctx.prisma.message.create({ data: { companyId: companyA.id, conversationId: conversation.id, direction: "INBOUND", senderType: "CONTACT", body: "Ciclo antigo" } });
      expect((await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/close`)).status).toBe(200);

      anthropic.respondWith(() => replyText("Olá de novo!"));
      await customerSays(customer, "Voltei");
      const reopened = await conversationOf(customer);
      expect(reopened.id).toBe(conversation.id);
      expect(reopened).toMatchObject({ mode: "AI", status: "OPEN", assignedUserId: null, closedAt: null });
      expect(await h.ctx.prisma.conversation.count({ where: { contactId: contact.id } })).toBe(1);
      expect(await h.ctx.prisma.message.count({ where: { conversationId: conversation.id, body: "Ciclo antigo" } })).toBe(1);
      expect(graph.messageRequests().map((request) => JSON.stringify(request.body))).toEqual([expect.stringContaining("Olá de novo!")]);
      expect(await h.ctx.prisma.auditLog.count({ where: { action: "conversation.reopened", entityId: conversation.id } })).toBe(1);
    });

    it("[#24] padrão humano: reabre na fila e é distribuída; eventos repetidos não reabrem duas vezes", async () => {
      const first = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      await customerSays(customer);
      const conversation = await conversationOf(customer);
      await as(h.ctx, first.cookie).post(`${convPath(conversation)}/close`);
      await setAvailability(first, "AWAY");
      const second = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });

      const payload = inboundPayload({ phoneNumberId: PHONE_A, from: customer, wamid: "wamid.REABRE", text: "Preciso de ajuda de novo" });
      await postWebhook(h.ctx, payload);
      await postWebhook(h.ctx, { ...payload, repetido: true });
      await settle();
      const reopened = await conversationOf(customer);
      expect(reopened).toMatchObject({ id: conversation.id, mode: "HUMAN", status: "ASSIGNED", assignedUserId: second.id });
      expect(await h.ctx.prisma.auditLog.count({ where: { action: "conversation.reopened", entityId: conversation.id } })).toBe(1);
      const history = await h.ctx.prisma.conversationAssignment.findMany({ where: { conversationId: conversation.id }, orderBy: { assignedAt: "asc" } });
      expect(history.map((row) => [row.userId, row.endReason])).toEqual([
        [first.id, "CLOSED"],
        [second.id, null],
      ]);
    });

    it("humana antiga sem responsável (dados de antes da Fase 5) entra na fila quando o cliente escreve", async () => {
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE" });
      const customer = newCustomer();
      const contact = await h.ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Antigo", phone: customer, whatsappId: customer } });
      const legacy = await h.ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contact.id, channel: "WHATSAPP", mode: "HUMAN" } });
      await h.team.drain();
      expect((await h.ctx.prisma.conversation.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe("OPEN");
      await customerSays(customer, "Oi, voltei");
      expect(await conversationOf(customer)).toMatchObject({ id: legacy.id, status: "ASSIGNED", assignedUserId: agent.id });
    });
  });

  describe("[#26 #27 #28] integração com a IA", () => {
    it("[#26] a IA transfere para humano: entra na fila e é distribuída automaticamente", async () => {
      await h.ctx.prisma.aiSettings.update({ where: { companyId: companyA.id }, data: { defaultConversationMode: "AI", enabled: true } });
      anthropic.respondWith(() => replyHandoff("cliente_pediu"));
      const customer = newCustomer();
      await customerSays(customer, "Quero falar com uma pessoa");
      // Ninguém disponível: fica na fila (aviso de transferência da IA + aviso de espera).
      expect(await conversationOf(customer)).toMatchObject({ mode: "HUMAN", status: "QUEUED", aiHandoffReason: "CUSTOMER_REQUEST" });
      expect(queueNotices()).toHaveLength(1);

      const agent = await addMember(h.ctx, companyA.id);
      expect((await setAvailability(agent, "AVAILABLE")).status).toBe(200);
      expect(await conversationOf(customer)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
      // Atribuída a um humano: a IA não responde mais.
      anthropic.reset();
      await customerSays(customer, "Oi?");
      expect(anthropic.requests).toHaveLength(0);
    });

    it("[#27] devolver para a IA tira o responsável e a fila, libera a vaga e não responde retroativamente", async () => {
      await h.ctx.prisma.aiSettings.update({ where: { companyId: companyA.id }, data: { enabled: true } });
      const agent = await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 1 });
      const [mine, waiting] = [newCustomer(), newCustomer()];
      await customerSays(mine, "Pergunta feita ao humano");
      await customerSays(waiting);
      const conversation = await conversationOf(mine);
      const back = await as(h.ctx, agent.cookie).post(`${convPath(conversation)}/mode`, { action: "RETURN_TO_AI" });
      expect(back.status).toBe(200);
      expect(await conversationOf(mine)).toMatchObject({ mode: "AI", status: "OPEN", assignedUserId: null });
      expect((await conversationOf(waiting)).assignedUserId).toBe(agent.id);
      const history = await h.ctx.prisma.conversationAssignment.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(history.endReason).toBe("RETURNED_TO_AI");
      await settle();
      expect(anthropic.requests).toHaveLength(0);
      anthropic.respondWith(() => replyText("Agora é com a IA."));
      await customerSays(mine, "Nova pergunta");
      expect(anthropic.requests).toHaveLength(1);
    });

    it("[#28] tarefas da IA incompatíveis são canceladas (assumir e encerrar)", async () => {
      await h.ctx.prisma.aiSettings.update({ where: { companyId: companyA.id }, data: { defaultConversationMode: "AI", enabled: true } });
      await h.ctx.prisma.aiSettings.update({ where: { companyId: companyA.id }, data: { enabled: false } });
      const customer = newCustomer();
      await postWebhook(h.ctx, inboundPayload({ phoneNumberId: PHONE_A, from: customer, text: "Oi" }));
      await h.whatsapp.drain(); // tarefa da IA criada, ainda PENDING
      const conversation = await conversationOf(customer);
      expect(await h.ctx.prisma.aiReplyTask.count({ where: { conversationId: conversation.id, status: "PENDING" } })).toBe(1);
      expect((await as(h.ctx, owner.cookie).post(`${convPath(conversation)}/mode`, { action: "ASSUME" })).status).toBe(200);
      expect(await h.ctx.prisma.aiReplyTask.findFirstOrThrow({ where: { conversationId: conversation.id } })).toMatchObject({ status: "CANCELED" });
      expect(await conversationOf(customer)).toMatchObject({ status: "ASSIGNED", assignedUserId: owner.id });
    });
  });

  describe("[#29 #30] recuperação e concorrência", () => {
    it("[#29] a fila persiste: após reiniciar a API, as conversas pendentes são distribuídas e avisadas", async () => {
      const customers = [newCustomer(), newCustomer()];
      for (const from of customers) {
        await postWebhook(h.ctx, inboundPayload({ phoneNumberId: PHONE_A, from, text: "Oi" }));
      }
      await h.whatsapp.drain(); // na fila, sem aviso (o worker da equipe ainda não rodou)
      expect(queueNotices()).toHaveLength(0);
      const agent = await addMember(h.ctx, companyA.id);
      await h.ctx.prisma.companyMember.update({ where: { userId: agent.id }, data: { availability: "AVAILABLE", maxConcurrent: 1 } });

      await h.ctx.app.close();
      h = await boot(); // "reinício"
      await h.team.drain();
      const conversations = await Promise.all(customers.map(conversationOf));
      expect(conversations.map((conversation) => conversation.status).sort()).toEqual(["ASSIGNED", "QUEUED"]);
      expect(queueNotices()).toHaveLength(1);
    });

    it("[#30] vários workers distribuindo ao mesmo tempo: nenhum limite estourado, nenhuma atribuição dupla", async () => {
      const agents = [
        await addMember(h.ctx, companyA.id, { maxConcurrent: 3 }),
        await addMember(h.ctx, companyA.id, { maxConcurrent: 3 }),
      ];
      const contact = await createContactRow(h.ctx.prisma, companyA.id);
      for (let index = 0; index < 10; index += 1) {
        await h.ctx.prisma.conversation.create({
          data: { companyId: companyA.id, contactId: contact.id, mode: "HUMAN", status: "QUEUED", queuedAt: new Date(Date.now() + index) },
        });
      }
      await h.ctx.prisma.companyMember.updateMany({ where: { userId: { in: agents.map((agent) => agent.id) } }, data: { availability: "AVAILABLE" } });
      await Promise.all([
        h.distribution.distribute(companyA.id),
        h.distribution.distribute(companyA.id),
        h.distribution.distribute(companyA.id),
        h.distribution.distribute(companyA.id),
        h.team.drain(),
      ]);
      for (const agent of agents) expect(await loadOf(agent.id)).toBe(3);
      expect(await h.ctx.prisma.conversation.count({ where: { status: "QUEUED" } })).toBe(4);
      expect(await h.ctx.prisma.conversationAssignment.count()).toBe(6);
      // Ordem de chegada: as 4 que ficaram na fila são as 4 que chegaram por último.
      const all = await h.ctx.prisma.conversation.findMany({ where: { companyId: companyA.id }, orderBy: { id: "asc" }, select: { status: true } });
      expect(all.map((row) => row.status)).toEqual([...Array<string>(6).fill("ASSIGNED"), ...Array<string>(4).fill("QUEUED")]);
    });

    it("mensagens simultâneas de vários clientes: cada conversa com exatamente um responsável, limites respeitados", async () => {
      const agents = [
        await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 2 }),
        await addMember(h.ctx, companyA.id, { availability: "AVAILABLE", maxConcurrent: 2 }),
      ];
      const customers = Array.from({ length: 6 }, () => newCustomer());
      await Promise.all(customers.map((from) => postWebhook(h.ctx, inboundPayload({ phoneNumberId: PHONE_A, from, text: "Oi" }))));
      await Promise.all([h.whatsapp.drain(), h.team.drain(), h.distribution.distribute(companyA.id)]);
      await settle();
      for (const agent of agents) expect(await loadOf(agent.id)).toBe(2);
      expect(await h.ctx.prisma.conversation.count({ where: { status: "QUEUED" } })).toBe(2);
      const open = await h.ctx.prisma.conversationAssignment.groupBy({ by: ["conversationId"], where: { endedAt: null }, _count: { _all: true } });
      expect(open.every((row) => row._count._all === 1)).toBe(true);
    });
  });
});
