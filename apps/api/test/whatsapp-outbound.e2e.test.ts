import type { Company, Contact, Conversation, ConversationMode } from "@arthur-ai/database";
import type { ApiError, ConversationDetail, MessageItem } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppOutboundService } from "../src/whatsapp/whatsapp-outbound.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { createCompany, createMember, createTestApp, login, ORIGIN, resetDatabase, type TestContext } from "./helpers.js";
import {
  createAccountRow,
  enableWhatsAppEnv,
  GRAPH_VERSION,
  inboundPayload,
  metaError,
  MockGraphApi,
  nextWamid,
  postWebhook,
  statusPayload,
} from "./whatsapp-helpers.js";

const PHONE_A = "111111111111111";
const PHONE_B = "222222222222222";
const CLIENT = "5511988887777";

describe("Envio pelo WhatsApp", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let restoreEnv: () => void;
  let worker: WhatsAppWorker;
  let companyA: Company;
  let companyB: Company;
  let cookieA: string;
  let contactA: Contact;

  const send = (company: Company, conversationId: string, cookie: string, body: string) =>
    ctx.http.post(`/api/companies/${company.id}/conversations/${conversationId}/messages`).set("Origin", ORIGIN).set("Cookie", cookie).send({ body });

  /** Conversa WhatsApp com janela de 24h aberta (cliente escreveu há 1 minuto). */
  async function whatsappConversation(company: Company, contact: Contact, mode: ConversationMode = "HUMAN", lastInboundAt: Date | null = new Date(Date.now() - 60_000)): Promise<Conversation> {
    return ctx.prisma.conversation.create({ data: { companyId: company.id, contactId: contact.id, channel: "WHATSAPP", mode, lastInboundAt } });
  }

  beforeAll(async () => {
    graph = new MockGraphApi();
    await graph.start();
    restoreEnv = enableWhatsAppEnv(graph.url);
    ctx = await createTestApp();
    worker = ctx.app.get(WhatsAppWorker);
  });

  beforeEach(async () => {
    await worker.drain();
    await resetDatabase(ctx.prisma);
    graph.reset();
    companyA = await createCompany(ctx.prisma, { name: "Empresa A" });
    companyB = await createCompany(ctx.prisma, { name: "Empresa B" });
    await createAccountRow(ctx.prisma, companyA.id, PHONE_A, { token: "token-secreto-da-empresa-A-123" });
    await createAccountRow(ctx.prisma, companyB.id, PHONE_B, { token: "token-secreto-da-empresa-B-456" });
    cookieA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id)).email);
    contactA = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Cliente", phone: CLIENT, whatsappId: CLIENT } });
  });

  afterAll(async () => {
    await worker.drain();
    await ctx.app.close();
    await graph.stop();
    restoreEnv();
  });

  describe("[#9] envio pelo funcionário", () => {
    it("envia pela Cloud API com o número e o token da própria empresa e guarda o wamid", async () => {
      const conversation = await whatsappConversation(companyA, contactA);
      const response = await send(companyA, conversation.id, cookieA, "Olá! Posso ajudar?");
      expect(response.status).toBe(201);
      const message = response.body as MessageItem;
      expect(message).toMatchObject({ direction: "OUTBOUND", deliveryStatus: "SENT", body: "Olá! Posso ajudar?", errorMessage: null });

      const [request] = graph.messageRequests();
      expect(request?.path).toBe(`/${GRAPH_VERSION}/${PHONE_A}/messages`);
      expect(request?.authorization).toBe("Bearer token-secreto-da-empresa-A-123");
      expect(request?.body).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: CLIENT,
        type: "text",
        text: { body: "Olá! Posso ajudar?", preview_url: false },
      });
      const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(row.externalId).toMatch(/^wamid\./);
      expect(row.sentAt).not.toBeNull();
      expect(JSON.stringify(response.body)).not.toContain("token-secreto");
    });

    it("usa o wa_id do contato quando ele difere do telefone cadastrado", async () => {
      const contact = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Antigo", phone: "5511977776666", whatsappId: "551177776666" } });
      const conversation = await whatsappConversation(companyA, contact);
      await send(companyA, conversation.id, cookieA, "oi");
      expect((graph.messageRequests()[0]?.body as { to: string }).to).toBe("551177776666");
    });

    it("conversa interna continua interna: nada é enviado à Meta", async () => {
      const conversation = await ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contactA.id, channel: "INTERNAL", mode: "HUMAN" } });
      const response = await send(companyA, conversation.id, cookieA, "nota interna");
      expect(response.status).toBe(201);
      expect((response.body as MessageItem).deliveryStatus).toBeNull();
      expect(graph.requests).toHaveLength(0);
    });
  });

  describe("[#10] falhas no envio", () => {
    it("token inválido (190): FAILED, conta marcada com erro, mensagem nunca aparece como enviada", async () => {
      graph.respondWith(() => metaError(190, 401));
      const conversation = await whatsappConversation(companyA, contactA);
      const message = (await send(companyA, conversation.id, cookieA, "oi")).body as MessageItem;
      expect(message.deliveryStatus).toBe("FAILED");
      expect(message.errorMessage).toContain("credenciais");
      const account = await ctx.prisma.whatsAppAccount.findUniqueOrThrow({ where: { companyId: companyA.id } });
      expect(account).toMatchObject({ status: "ERROR", lastErrorCode: "190" });
      // Com a conta em erro, novos envios são bloqueados antes de chamar a Meta.
      graph.reset();
      expect((await send(companyA, conversation.id, cookieA, "de novo")).status).toBe(503);
      expect(graph.requests).toHaveLength(0);
    });

    it("janela fechada informada pela Meta (131047): FAILED com explicação", async () => {
      graph.respondWith(() => metaError(131047));
      const conversation = await whatsappConversation(companyA, contactA);
      const message = (await send(companyA, conversation.id, cookieA, "oi")).body as MessageItem;
      expect(message).toMatchObject({ deliveryStatus: "FAILED" });
      expect(message.errorMessage).toContain("24 horas");
    });

    it("limite da API (130429): fica PENDING e o worker reenvia com sucesso depois", async () => {
      graph.respondWith(() => metaError(130429, 429));
      const conversation = await whatsappConversation(companyA, contactA);
      const message = (await send(companyA, conversation.id, cookieA, "oi")).body as MessageItem;
      expect(message.deliveryStatus).toBe("PENDING");
      expect(message.errorMessage).toContain("tentará novamente");

      graph.reset();
      await ctx.prisma.message.update({ where: { id: message.id }, data: { nextSendAttemptAt: new Date(Date.now() - 1000) } });
      await worker.drain();
      const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(row).toMatchObject({ deliveryStatus: "SENT", sendAttempts: 2, errorMessage: null });
      expect(graph.messageRequests()).toHaveLength(1);
    });

    it("rede fora do ar: retenta e vira FAILED quando as tentativas acabam", async () => {
      graph.respondWith(() => "drop");
      const conversation = await whatsappConversation(companyA, contactA);
      const message = (await send(companyA, conversation.id, cookieA, "oi")).body as MessageItem;
      expect(message.deliveryStatus).toBe("PENDING");
      for (let i = 0; i < 6; i++) {
        await ctx.prisma.message.updateMany({ where: { id: message.id, deliveryStatus: "PENDING" }, data: { nextSendAttemptAt: new Date(Date.now() - 1000) } });
        await worker.drain();
      }
      const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(row).toMatchObject({ deliveryStatus: "FAILED", sendAttempts: 5, errorCode: "NETWORK" });
      expect(row.errorMessage).toContain("Tentativas esgotadas");
    });

    it("janela de 24h fechada no nosso lado: 409 e nenhuma chamada à Meta", async () => {
      const old = await whatsappConversation(companyA, contactA, "HUMAN", new Date(Date.now() - 25 * 3_600_000));
      const never = await whatsappConversation(companyA, contactA, "HUMAN", null);
      for (const conversation of [old, never]) {
        const response = await send(companyA, conversation.id, cookieA, "oi");
        expect(response.status).toBe(409);
        expect((response.body as ApiError).message).toContain("24 horas");
      }
      expect(graph.requests).toHaveLength(0);
      expect(await ctx.prisma.message.count()).toBe(0);
    });

    it("integração desativada ou empresa sem número: bloqueia sem chamar a Meta", async () => {
      const conversation = await whatsappConversation(companyA, contactA);
      await ctx.prisma.whatsAppAccount.update({ where: { companyId: companyA.id }, data: { status: "DISABLED" } });
      expect((await send(companyA, conversation.id, cookieA, "oi")).status).toBe(503);
      await ctx.prisma.whatsAppAccount.delete({ where: { companyId: companyA.id } });
      expect((await send(companyA, conversation.id, cookieA, "oi")).status).toBe(503);
      expect(graph.requests).toHaveLength(0);
    });
  });

  describe("[#11][#12] estados das mensagens", () => {
    async function sentMessage() {
      const conversation = await whatsappConversation(companyA, contactA);
      const message = (await send(companyA, conversation.id, cookieA, "oi")).body as MessageItem;
      const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      return { id: row.id, wamid: row.externalId ?? "" };
    }
    const status = async (wamid: string, value: string, errorCode?: number) => {
      await postWebhook(ctx, statusPayload(PHONE_A, wamid, value, errorCode ? { errorCode } : {}));
      await worker.drain();
    };
    const current = async (id: string) => ctx.prisma.message.findUniqueOrThrow({ where: { id } });

    it("sent → delivered → read, com datas, visível pela API", async () => {
      const { id, wamid } = await sentMessage();
      await status(wamid, "delivered");
      expect((await current(id)).deliveryStatus).toBe("DELIVERED");
      await status(wamid, "read");
      const row = await current(id);
      expect(row.deliveryStatus).toBe("READ");
      expect(row.deliveredAt).not.toBeNull();
      expect(row.readAt).not.toBeNull();
      const conversation = await ctx.prisma.message.findUniqueOrThrow({ where: { id }, select: { conversationId: true } });
      const page = (await ctx.http.get(`/api/companies/${companyA.id}/conversations/${conversation.conversationId}/messages`).set("Cookie", cookieA)).body as { items: MessageItem[] };
      expect(page.items[0]?.deliveryStatus).toBe("READ");
    });

    it("fora de ordem e repetidos não regridem: read antes de delivered continua READ", async () => {
      const { id, wamid } = await sentMessage();
      await status(wamid, "read");
      await status(wamid, "delivered");
      await status(wamid, "sent");
      await status(wamid, "read");
      expect((await current(id)).deliveryStatus).toBe("READ");
    });

    it("failed depois de sent: FAILED com o motivo traduzido", async () => {
      const { id, wamid } = await sentMessage();
      await status(wamid, "failed", 131026);
      const row = await current(id);
      expect(row).toMatchObject({ deliveryStatus: "FAILED", errorCode: "131026" });
      expect(row.errorMessage).toContain("não pode receber");
    });

    it("failed não desfaz uma mensagem já lida", async () => {
      const { id, wamid } = await sentMessage();
      await status(wamid, "read");
      await status(wamid, "failed", 131026);
      expect((await current(id)).deliveryStatus).toBe("READ");
    });

    it("status desconhecido (ex.: 'deleted') é ignorado com segurança", async () => {
      const { id, wamid } = await sentMessage();
      await status(wamid, "deleted");
      expect((await current(id)).deliveryStatus).toBe("SENT");
    });

    it("status que chega antes do wamid ser gravado é reprocessado depois", async () => {
      const wamid = nextWamid();
      await postWebhook(ctx, statusPayload(PHONE_A, wamid, "delivered"));
      await worker.drain();
      const event = await ctx.prisma.whatsAppWebhookEvent.findFirstOrThrow();
      expect(event.status).toBe("PENDING");

      const conversation = await whatsappConversation(companyA, contactA);
      const message = await ctx.prisma.message.create({
        data: { companyId: companyA.id, conversationId: conversation.id, direction: "OUTBOUND", senderType: "AGENT", body: "x", externalId: wamid, deliveryStatus: "SENT" },
      });
      await ctx.prisma.whatsAppWebhookEvent.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await worker.drain();
      expect((await current(message.id)).deliveryStatus).toBe("DELIVERED");
    });
  });

  describe("[#13] modos de atendimento", () => {
    it("só envia em HUMAN; em AI e PAUSED devolve 409 sem chamar a Meta", async () => {
      for (const mode of ["AI", "PAUSED"] as const) {
        const conversation = await whatsappConversation(companyA, contactA, mode);
        const response = await send(companyA, conversation.id, cookieA, "oi");
        expect(response.status, mode).toBe(409);
        expect((response.body as ApiError).message).toBe("Assuma o atendimento para responder manualmente.");
      }
      expect(graph.requests).toHaveLength(0);
    });

    it("mensagem recebida não muda o modo, em nenhum dos três", async () => {
      for (const [index, mode] of (["AI", "HUMAN", "PAUSED"] as const).entries()) {
        const phone = `551190000000${index}`;
        const contact = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: mode, phone, whatsappId: phone } });
        const conversation = await whatsappConversation(companyA, contact, mode);
        await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from: phone, text: `msg ${mode}` }));
        await worker.drain();
        const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
        expect(row.mode).toBe(mode);
        expect(row.unreadCount).toBe(1);
      }
      // Nenhuma resposta automática é gerada nesta fase.
      expect(graph.messageRequests()).toHaveLength(0);
    });

    it("assumir pela Inbox libera o envio; devolver para IA bloqueia de novo", async () => {
      const conversation = await whatsappConversation(companyA, contactA, "AI");
      const mode = (action: string) =>
        ctx.http.post(`/api/companies/${companyA.id}/conversations/${conversation.id}/mode`).set("Origin", ORIGIN).set("Cookie", cookieA).send({ action });
      const assumed = (await mode("ASSUME")).body as ConversationDetail;
      expect(assumed).toMatchObject({ channel: "WHATSAPP", humanMayReply: true, serviceWindowOpen: true });
      expect((await send(companyA, conversation.id, cookieA, "agora sim")).status).toBe(201);
      await mode("RETURN_TO_AI");
      expect((await send(companyA, conversation.id, cookieA, "de novo")).status).toBe(409);
      expect(graph.messageRequests()).toHaveLength(1);
    });

    it("preparação Fase 4: o serviço aceita remetente IA só no modo AI", async () => {
      const outbound = ctx.app.get(WhatsAppOutboundService);
      const human = await whatsappConversation(companyA, contactA, "HUMAN");
      await expect(outbound.send(companyA, human.id, "resposta da IA", { type: "AI" })).rejects.toThrow("modo IA");
      const ai = await whatsappConversation(companyA, contactA, "AI");
      const message = await outbound.send(companyA, ai.id, "resposta da IA", { type: "AI" });
      expect(message).toMatchObject({ senderType: "AI", deliveryStatus: "SENT" });
    });
  });

  describe("[#8] isolamento no envio", () => {
    it("usuário da A não envia em conversa da B, e o token da B nunca é usado", async () => {
      const contactB = await ctx.prisma.contact.create({ data: { companyId: companyB.id, name: "Cliente B", phone: CLIENT, whatsappId: CLIENT } });
      const conversationB = await whatsappConversation(companyB, contactB);
      expect((await send(companyB, conversationB.id, cookieA, "invasão")).status).toBe(403);
      expect((await send(companyA, conversationB.id, cookieA, "invasão")).status).toBe(404);
      expect(graph.requests).toHaveLength(0);
      expect(await ctx.prisma.message.count({ where: { conversationId: conversationB.id } })).toBe(0);
    });

    it("cada empresa envia com o próprio número e token", async () => {
      const contactB = await ctx.prisma.contact.create({ data: { companyId: companyB.id, name: "Cliente B", phone: CLIENT, whatsappId: CLIENT } });
      const conversationA = await whatsappConversation(companyA, contactA);
      const conversationB = await whatsappConversation(companyB, contactB);
      const cookieB = await login(ctx.http, (await createMember(ctx.prisma, companyB.id)).email);
      await send(companyA, conversationA.id, cookieA, "de A");
      await send(companyB, conversationB.id, cookieB, "de B");
      const [fromA, fromB] = graph.messageRequests();
      expect(fromA).toMatchObject({ path: `/${GRAPH_VERSION}/${PHONE_A}/messages`, authorization: "Bearer token-secreto-da-empresa-A-123" });
      expect(fromB).toMatchObject({ path: `/${GRAPH_VERSION}/${PHONE_B}/messages`, authorization: "Bearer token-secreto-da-empresa-B-456" });
    });
  });
});
