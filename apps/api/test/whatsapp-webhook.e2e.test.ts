import type { Company } from "@arthur-ai/database";
import type { ConversationSummary, MessagePage, Paginated } from "@arthur-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { createCompany, createMember, createTestApp, login, resetDatabase, type TestContext } from "./helpers.js";
import {
  createAccountRow,
  enableWhatsAppEnv,
  inboundPayload,
  MockGraphApi,
  nextWamid,
  postWebhook,
  statusPayload,
  TEST_VERIFY_TOKEN,
} from "./whatsapp-helpers.js";

const PHONE_A = "111111111111111";
const PHONE_B = "222222222222222";

describe("Webhook do WhatsApp", () => {
  let ctx: TestContext;
  let graph: MockGraphApi;
  let restoreEnv: () => void;
  let worker: WhatsAppWorker;
  let companyA: Company;
  let companyB: Company;

  const deliver = async (payload: unknown) => {
    const response = await postWebhook(ctx, payload);
    await worker.drain();
    return response;
  };

  beforeAll(async () => {
    graph = new MockGraphApi();
    await graph.start();
    restoreEnv = enableWhatsAppEnv(graph.url);
    ctx = await createTestApp();
    worker = ctx.app.get(WhatsAppWorker);
  });

  beforeEach(async () => {
    // O webhook dispara o worker em segundo plano: espera esvaziar antes de limpar o banco.
    await worker.drain();
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Empresa A" });
    companyB = await createCompany(ctx.prisma, { name: "Empresa B" });
    await createAccountRow(ctx.prisma, companyA.id, PHONE_A);
    await createAccountRow(ctx.prisma, companyB.id, PHONE_B);
  });

  afterAll(async () => {
    await worker.drain();
    await ctx.app.close();
    await graph.stop();
    restoreEnv();
  });

  describe("[#1] verificação (handshake)", () => {
    const verify = (query: Record<string, string>) => ctx.http.get(`/api/webhooks/whatsapp?${new URLSearchParams(query).toString()}`);

    it("devolve o challenge em texto puro quando o verify token confere", async () => {
      const response = await verify({ "hub.mode": "subscribe", "hub.verify_token": TEST_VERIFY_TOKEN, "hub.challenge": "1158201444" });
      expect(response.status).toBe(200);
      expect(response.text).toBe("1158201444");
      expect(response.headers["content-type"]).toMatch(/text\/plain/);
    });

    it("recusa token errado, modo errado ou challenge suspeito", async () => {
      const base = { "hub.mode": "subscribe", "hub.verify_token": TEST_VERIFY_TOKEN, "hub.challenge": "123" };
      expect((await verify({ ...base, "hub.verify_token": "errado-errado-errado" })).status).toBe(403);
      expect((await verify({ ...base, "hub.mode": "unsubscribe" })).status).toBe(403);
      expect((await verify({ ...base, "hub.challenge": "<script>alert(1)</script>" })).status).toBe(403);
      expect((await verify({ "hub.mode": "subscribe" })).status).toBe(403);
    });
  });

  describe("[#2] assinatura", () => {
    it("rejeita assinatura ausente, inválida, de outro segredo ou corpo adulterado, sem gravar nada", async () => {
      const payload = inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777" });
      const raw = JSON.stringify(payload);
      const cases = [
        postWebhook(ctx, payload, { signature: "" }),
        postWebhook(ctx, payload, { signature: "sha256=deadbeef" }),
        postWebhook(ctx, payload, { secret: "outro-segredo-qualquer-123456" }),
        // Assinatura do corpo original, mas corpo trocado.
        postWebhook(ctx, payload, { raw: raw.replace("Olá!", "Olá?"), signature: (await import("../src/whatsapp/webhook-signature.js")).signPayload(raw, "test-app-secret-0123456789abcdef") }),
      ];
      for (const response of await Promise.all(cases)) expect(response.status).toBe(401);
      await worker.drain();
      expect(await ctx.prisma.whatsAppWebhookEvent.count()).toBe(0);
      expect(await ctx.prisma.message.count()).toBe(0);
    });

    it("não exige sessão nem Origin (servidor→servidor)", async () => {
      const response = await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777" }));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });
  });

  describe("[#3][#4][#5] mensagem recebida", () => {
    it("cria contato, conversa WhatsApp em modo IA e mensagem com o wamid", async () => {
      const wamid = nextWamid("wamid.IN");
      const timestamp = Math.floor(Date.now() / 1000) - 60;
      expect((await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", wamid, text: "Quero agendar", name: "Joana Cliente", timestamp }))).status).toBe(200);

      const contact = await ctx.prisma.contact.findFirstOrThrow({ where: { companyId: companyA.id } });
      expect(contact).toMatchObject({ name: "Joana Cliente", phone: "5511988887777", whatsappId: "5511988887777", source: "WHATSAPP", status: "NEW" });

      const conversation = await ctx.prisma.conversation.findFirstOrThrow({ where: { companyId: companyA.id } });
      expect(conversation).toMatchObject({ channel: "WHATSAPP", mode: "AI", unreadCount: 1, contactId: contact.id, lastMessagePreview: "Quero agendar" });
      expect(conversation.lastInboundAt?.getTime()).toBe(timestamp * 1000);

      const message = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(message).toMatchObject({ direction: "INBOUND", senderType: "CONTACT", body: "Quero agendar", externalId: wamid, externalType: "text", deliveryStatus: null, companyId: companyA.id });

      const event = await ctx.prisma.whatsAppWebhookEvent.findFirstOrThrow();
      expect(event).toMatchObject({ status: "PROCESSED", companyId: companyA.id });
    });

    it("segunda mensagem do mesmo cliente reaproveita contato e conversa", async () => {
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "Oi" }));
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "Tudo bem?" }));
      expect(await ctx.prisma.contact.count({ where: { companyId: companyA.id } })).toBe(1);
      expect(await ctx.prisma.conversation.count({ where: { companyId: companyA.id } })).toBe(1);
      const conversation = await ctx.prisma.conversation.findFirstOrThrow({ where: { companyId: companyA.id } });
      expect(conversation.unreadCount).toBe(2);
      expect(conversation.lastMessagePreview).toBe("Tudo bem?");
    });

    it("vincula a um contato já cadastrado, mesmo com diferença do 9º dígito", async () => {
      const existing = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Cadastrado à mão", phone: "5511988887777" } });
      // wa_id sem o 9: 55 11 88887777
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "551188887777", name: "Nome do perfil" }));
      expect(await ctx.prisma.contact.count({ where: { companyId: companyA.id } })).toBe(1);
      const contact = await ctx.prisma.contact.findUniqueOrThrow({ where: { id: existing.id } });
      expect(contact).toMatchObject({ name: "Cadastrado à mão", whatsappId: "551188887777" });
    });

    it("conversa interna existente não é reutilizada: o WhatsApp abre a sua", async () => {
      const contact = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "Contato", phone: "5511988887777" } });
      await ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contact.id, channel: "INTERNAL" } });
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777" }));
      expect(await ctx.prisma.conversation.count({ where: { contactId: contact.id, channel: "WHATSAPP" } })).toBe(1);
    });

    it("tipo não suportado é guardado com aviso, sem perder a mensagem", async () => {
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", type: "image" }));
      const message = await ctx.prisma.message.findFirstOrThrow({ where: { companyId: companyA.id } });
      expect(message.externalType).toBe("image");
      expect(message.body).toContain('tipo "image"');
    });

    it("aparece na Inbox da empresa certa pela API autenticada", async () => {
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "Chegou pela Inbox?" }));
      const cookie = await login(ctx.http, (await createMember(ctx.prisma, companyA.id)).email);
      const list = (await ctx.http.get(`/api/companies/${companyA.id}/conversations?filter=unread`).set("Cookie", cookie)).body as Paginated<ConversationSummary>;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ channel: "WHATSAPP", unreadCount: 1 });
      const messages = (await ctx.http.get(`/api/companies/${companyA.id}/conversations/${list.items[0]?.id ?? ""}/messages`).set("Cookie", cookie)).body as MessagePage;
      expect(messages.items.map((m) => m.body)).toEqual(["Chegou pela Inbox?"]);
    });
  });

  describe("[#6][#12] duplicatas e eventos repetidos", () => {
    it("reenvio idêntico da Meta é descartado na entrada", async () => {
      const payload = inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777" });
      await deliver(payload);
      await deliver(payload);
      await deliver(payload);
      expect(await ctx.prisma.whatsAppWebhookEvent.count()).toBe(1);
      expect(await ctx.prisma.message.count()).toBe(1);
    });

    it("mesmo wamid em payloads diferentes não duplica e não soma não lidas", async () => {
      const wamid = nextWamid("wamid.IN");
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", wamid, name: "A" }));
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", wamid, name: "B" }));
      expect(await ctx.prisma.whatsAppWebhookEvent.count()).toBe(2);
      expect(await ctx.prisma.message.count()).toBe(1);
      expect((await ctx.prisma.conversation.findFirstOrThrow()).unreadCount).toBe(1);
    });

    it("entregas simultâneas do mesmo wamid geram uma só mensagem", async () => {
      const wamid = nextWamid("wamid.IN");
      const payloads = ["x", "y", "z", "w"].map((name) => inboundPayload({ phoneNumberId: PHONE_A, from: "5511977776666", wamid, name }));
      await Promise.all(payloads.map((payload) => postWebhook(ctx, payload)));
      await Promise.all([worker.drain(), worker.drain()]);
      expect(await ctx.prisma.message.count({ where: { externalId: wamid } })).toBe(1);
      expect(await ctx.prisma.contact.count({ where: { companyId: companyA.id } })).toBe(1);
    });

    it("mensagens fora de ordem: a última exibida é a mais recente, não a última a chegar", async () => {
      const now = Math.floor(Date.now() / 1000);
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "segunda", timestamp: now }));
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "primeira", timestamp: now - 120 }));
      const conversation = await ctx.prisma.conversation.findFirstOrThrow();
      expect(conversation.lastMessagePreview).toBe("segunda");
      expect(conversation.lastInboundAt?.getTime()).toBe(now * 1000);
    });

    it("eventos desconhecidos, campos novos e itens malformados não derrubam o processamento", async () => {
      const valid = inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "válida" }) as {
        entry: { changes: { value: { messages: unknown[]; novidade?: unknown } }[] }[];
      };
      const change = valid.entry[0]?.changes[0];
      if (!change) throw new Error("payload");
      change.value.messages.push({ from: "não-é-telefone", id: "x", timestamp: "1", type: "text" });
      change.value.novidade = { campo: "que a Meta inventou" };
      const unknownField = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "account_update", value: { foo: 1 } }] }] };
      const otherObject = { object: "page", entry: [] };

      expect((await deliver(valid)).status).toBe(200);
      expect((await deliver(unknownField)).status).toBe(200);
      expect((await deliver(otherObject)).status).toBe(200);
      expect(await ctx.prisma.message.count()).toBe(1);
      const statuses = (await ctx.prisma.whatsAppWebhookEvent.findMany({ orderBy: { receivedAt: "asc" } })).map((e) => e.status);
      expect(statuses).toEqual(["PROCESSED", "IGNORED", "IGNORED"]);
    });
  });

  describe("[#7][#8] roteamento e isolamento", () => {
    it("cada phone_number_id leva à sua empresa, mesmo com o mesmo cliente", async () => {
      await deliver(inboundPayload({ phoneNumberId: PHONE_A, from: "5511988887777", text: "para A" }));
      await deliver(inboundPayload({ phoneNumberId: PHONE_B, from: "5511988887777", text: "para B" }));
      const inA = await ctx.prisma.message.findMany({ where: { companyId: companyA.id } });
      const inB = await ctx.prisma.message.findMany({ where: { companyId: companyB.id } });
      expect(inA.map((m) => m.body)).toEqual(["para A"]);
      expect(inB.map((m) => m.body)).toEqual(["para B"]);
      expect(await ctx.prisma.contact.count({ where: { companyId: companyA.id } })).toBe(1);
      expect(await ctx.prisma.contact.count({ where: { companyId: companyB.id } })).toBe(1);
    });

    it("número não cadastrado ou integração desativada: evento ignorado, nada gravado", async () => {
      await deliver(inboundPayload({ phoneNumberId: "999999999999999", from: "5511988887777" }));
      await ctx.prisma.whatsAppAccount.update({ where: { companyId: companyB.id }, data: { status: "DISABLED" } });
      await deliver(inboundPayload({ phoneNumberId: PHONE_B, from: "5511988887777" }));
      expect(await ctx.prisma.message.count()).toBe(0);
      expect((await ctx.prisma.whatsAppWebhookEvent.findMany()).every((e) => e.status === "IGNORED")).toBe(true);
    });

    it("usuário da A não vê a conversa de WhatsApp da B", async () => {
      await deliver(inboundPayload({ phoneNumberId: PHONE_B, from: "5511988887777", text: "segredo da B" }));
      const conversationB = await ctx.prisma.conversation.findFirstOrThrow({ where: { companyId: companyB.id } });
      const cookieA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id)).email);
      const listA = (await ctx.http.get(`/api/companies/${companyA.id}/conversations`).set("Cookie", cookieA)).body as Paginated<ConversationSummary>;
      expect(listA.total).toBe(0);
      expect((await ctx.http.get(`/api/companies/${companyA.id}/conversations/${conversationB.id}/messages`).set("Cookie", cookieA)).status).toBe(404);
      expect((await ctx.http.get(`/api/companies/${companyB.id}/conversations`).set("Cookie", cookieA)).status).toBe(403);
    });

    it("status vindo pelo número da B não altera mensagem da A com o mesmo wamid", async () => {
      const contact = await ctx.prisma.contact.create({ data: { companyId: companyA.id, name: "C", phone: "5511988887777" } });
      const conversation = await ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contact.id, channel: "WHATSAPP" } });
      const wamid = nextWamid();
      const message = await ctx.prisma.message.create({
        data: { companyId: companyA.id, conversationId: conversation.id, direction: "OUTBOUND", senderType: "AGENT", body: "oi", externalId: wamid, deliveryStatus: "SENT" },
      });
      await deliver(statusPayload(PHONE_B, wamid, "read"));
      expect((await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } })).deliveryStatus).toBe("SENT");
      await deliver(statusPayload(PHONE_A, wamid, "read"));
      expect((await ctx.prisma.message.findUniqueOrThrow({ where: { id: message.id } })).deliveryStatus).toBe("READ");
    });
  });
});

describe("Webhook com a integração desabilitada no servidor", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    for (const key of ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_TOKEN_ENCRYPTION_KEY"]) {
      Reflect.deleteProperty(process.env, key);
    }
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("a API sobe, o webhook responde 503 (a Meta reenvia depois) e a verificação é recusada", async () => {
    const response = await ctx.http.post("/api/webhooks/whatsapp").set("Content-Type", "application/json").send("{}");
    expect(response.status).toBe(503);
    const verify = await ctx.http.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1");
    expect(verify.status).toBe(403);
  });
});
