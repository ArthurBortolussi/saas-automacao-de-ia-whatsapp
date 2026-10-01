import type {
  ApiError,
  ConversationDetail,
  ConversationSummary,
  MessageItem,
  MessagePage,
  Paginated,
} from "@arthur-ai/shared";
import type { Company, Contact, User } from "@arthur-ai/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCompany,
  createContactRow,
  createConversationRow,
  createMember,
  createTestApp,
  login,
  ORIGIN,
  resetDatabase,
  type TestContext,
} from "./helpers.js";

describe("Conversas, mensagens e modo de atendimento", () => {
  let ctx: TestContext;
  let companyA: Company;
  let companyB: Company;
  let ownerA: User;
  let cookieA: string;
  let cookieA2: string;
  let cookieB: string;
  let contactA: Contact;

  const base = (company: Company) => `/api/companies/${company.id}/conversations`;
  const post = (path: string, cookie: string, body: object = {}) =>
    ctx.http.post(path).set("Origin", ORIGIN).set("Cookie", cookie).send(body);
  const act = (company: Company, id: string, cookie: string, action: string) =>
    post(`${base(company)}/${id}/mode`, cookie, { action });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Empresa A" });
    companyB = await createCompany(ctx.prisma, { name: "Empresa B" });
    ownerA = await createMember(ctx.prisma, companyA.id, { role: "OWNER" });
    cookieA = await login(ctx.http, ownerA.email);
    cookieA2 = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "AGENT" })).email);
    cookieB = await login(ctx.http, (await createMember(ctx.prisma, companyB.id)).email);
    contactA = await createContactRow(ctx.prisma, companyA.id, "Cliente da A");
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("[#4] criação de conversas", () => {
    it("cria conversa para um contato da empresa, em HUMAN com o autor responsável", async () => {
      const response = await post(base(companyA), cookieA, { contactId: contactA.id });
      expect(response.status).toBe(201);
      const conversation = response.body as ConversationDetail;
      expect(conversation).toMatchObject({
        mode: "HUMAN",
        unreadCount: 0,
        assignedUser: { id: ownerA.id },
        contact: { id: contactA.id, name: "Cliente da A" },
        humanMayReply: true,
        aiMayReply: false,
      });
      const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(row.companyId).toBe(companyA.id);
    });

    it("contato de outra empresa: 404 e nenhuma conversa criada", async () => {
      const contactB = await createContactRow(ctx.prisma, companyB.id);
      const before = await ctx.prisma.conversation.count();
      const response = await post(base(companyA), cookieA, { contactId: contactB.id });
      expect(response.status).toBe(404);
      expect(await ctx.prisma.conversation.count()).toBe(before);
    });

    it("o banco recusa conversa ligando empresa A a contato da B (FK composta)", async () => {
      const contactB = await createContactRow(ctx.prisma, companyB.id);
      await expect(
        ctx.prisma.conversation.create({ data: { companyId: companyA.id, contactId: contactB.id } }),
      ).rejects.toThrow();
    });
  });

  describe("[#5][#6] mensagens internas e histórico", () => {
    it("envia mensagens e devolve o histórico em ordem cronológica, com autor", async () => {
      const conversation = (await post(base(companyA), cookieA, { contactId: contactA.id })).body as ConversationDetail;
      for (const body of ["Olá!", "Tudo bem?", "Posso ajudar?"]) {
        const sent = await post(`${base(companyA)}/${conversation.id}/messages`, cookieA, { body });
        expect(sent.status).toBe(201);
        expect(sent.body).toMatchObject({ direction: "OUTBOUND", senderType: "AGENT", body, sender: { id: ownerA.id } });
      }
      const page = (await ctx.http.get(`${base(companyA)}/${conversation.id}/messages`).set("Cookie", cookieA)).body as MessagePage;
      expect(page.items.map((m) => m.body)).toEqual(["Olá!", "Tudo bem?", "Posso ajudar?"]);
      expect(page.hasMore).toBe(false);

      const summary = (await ctx.http.get(base(companyA)).set("Cookie", cookieA)).body as Paginated<ConversationSummary>;
      expect(summary.items.find((c) => c.id === conversation.id)?.lastMessagePreview).toBe("Posso ajudar?");
    });

    it("histórico mistura recebidas e enviadas e pagina por cursor", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, {
        mode: "HUMAN",
        inbound: Array.from({ length: 5 }, (_, i) => `recebida ${i + 1}`),
      });
      await post(`${base(companyA)}/${conversation.id}/messages`, cookieA, { body: "resposta" });

      const url = `${base(companyA)}/${conversation.id}/messages`;
      const latest = (await ctx.http.get(`${url}?limit=4`).set("Cookie", cookieA)).body as MessagePage;
      expect(latest.items.map((m) => m.body)).toEqual(["recebida 3", "recebida 4", "recebida 5", "resposta"]);
      expect(latest.items.map((m) => m.direction)).toEqual(["INBOUND", "INBOUND", "INBOUND", "OUTBOUND"]);
      expect(latest.hasMore).toBe(true);

      const older = (await ctx.http.get(`${url}?limit=4&before=${latest.items[0]?.id ?? ""}`).set("Cookie", cookieA))
        .body as MessagePage;
      expect(older.items.map((m) => m.body)).toEqual(["recebida 1", "recebida 2"]);
      expect(older.hasMore).toBe(false);
    });

    it("mensagem vazia ou longa demais retorna 400", async () => {
      const conversation = (await post(base(companyA), cookieA, { contactId: contactA.id })).body as ConversationDetail;
      const url = `${base(companyA)}/${conversation.id}/messages`;
      expect((await post(url, cookieA, { body: "   " })).status).toBe(400);
      expect((await post(url, cookieA, { body: "x".repeat(4001) })).status).toBe(400);
    });

    it("não envia com a conversa em AI ou PAUSED (409) e nada é gravado", async () => {
      for (const mode of ["AI", "PAUSED"] as const) {
        const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode });
        const response = await post(`${base(companyA)}/${conversation.id}/messages`, cookieA, { body: "oi" });
        expect(response.status).toBe(409);
        expect((response.body as ApiError).message).toBe("Assuma o atendimento para responder manualmente.");
        expect(await ctx.prisma.message.count({ where: { conversationId: conversation.id } })).toBe(0);
      }
    });

    it("marcar como lida zera o contador e o filtro de não lidas reflete isso", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { inbound: ["a", "b"] });
      const unread = (await ctx.http.get(`${base(companyA)}?filter=unread`).set("Cookie", cookieA)).body as Paginated<ConversationSummary>;
      expect(unread.items.find((c) => c.id === conversation.id)?.unreadCount).toBe(2);

      expect((await post(`${base(companyA)}/${conversation.id}/read`, cookieA)).status).toBe(204);
      const after = (await ctx.http.get(`${base(companyA)}?filter=unread`).set("Cookie", cookieA)).body as Paginated<ConversationSummary>;
      expect(after.items.some((c) => c.id === conversation.id)).toBe(false);
    });
  });

  describe("[#7] modo de atendimento", () => {
    it("percorre AI → HUMAN → PAUSED → HUMAN → AI e grava no banco com auditoria", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode: "AI" });
      const row = () => ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });

      const assumed = (await act(companyA, conversation.id, cookieA, "ASSUME")).body as ConversationDetail;
      expect(assumed).toMatchObject({ mode: "HUMAN", assignedUser: { id: ownerA.id }, aiMayReply: false, humanMayReply: true });

      const paused = (await act(companyA, conversation.id, cookieA, "PAUSE")).body as ConversationDetail;
      expect(paused).toMatchObject({ mode: "PAUSED", aiMayReply: false, humanMayReply: false });
      expect((await row()).modeBeforePause).toBe("HUMAN");

      const resumed = (await act(companyA, conversation.id, cookieA, "RESUME")).body as ConversationDetail;
      expect(resumed).toMatchObject({ mode: "HUMAN", assignedUser: { id: ownerA.id } });
      expect((await row()).modeBeforePause).toBeNull();

      const back = (await act(companyA, conversation.id, cookieA, "RETURN_TO_AI")).body as ConversationDetail;
      expect(back).toMatchObject({ mode: "AI", assignedUser: null, aiMayReply: true });
      expect((await row()).mode).toBe("AI");

      const audits = await ctx.prisma.auditLog.findMany({
        where: { action: "conversation.mode_changed", entityId: conversation.id },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((a) => a.metadata)).toEqual([
        { action: "ASSUME", from: "AI", to: "HUMAN" },
        { action: "PAUSE", from: "HUMAN", to: "PAUSED" },
        { action: "RESUME", from: "PAUSED", to: "HUMAN" },
        { action: "RETURN_TO_AI", from: "HUMAN", to: "AI" },
      ]);
    });

    it("pausar a partir de AI e reativar volta para AI", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode: "AI" });
      expect(((await act(companyA, conversation.id, cookieA, "PAUSE")).body as ConversationDetail).mode).toBe("PAUSED");
      expect(((await act(companyA, conversation.id, cookieA, "RESUME")).body as ConversationDetail).mode).toBe("AI");
    });

    it("outro atendente pode assumir: o responsável muda", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode: "AI" });
      await act(companyA, conversation.id, cookieA, "ASSUME");
      await act(companyA, conversation.id, cookieA, "PAUSE");
      const response = await act(companyA, conversation.id, cookieA2, "ASSUME");
      expect(response.status).toBe(200);
      expect((response.body as ConversationDetail).assignedUser?.id).not.toBe(ownerA.id);
    });

    it("transições inválidas retornam 409 e não alteram nada", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode: "AI" });
      for (const action of ["RETURN_TO_AI", "RESUME"]) {
        const response = await act(companyA, conversation.id, cookieA, action);
        expect(response.status, action).toBe(409);
      }
      expect((await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).mode).toBe("AI");
    });

    it("ação desconhecida retorna 400", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id);
      expect((await act(companyA, conversation.id, cookieA, "EXPLODIR")).status).toBe(400);
    });

    it("duas ações simultâneas: só uma vence, a outra recebe 409", async () => {
      const conversation = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { mode: "AI" });
      const results = await Promise.all([
        act(companyA, conversation.id, cookieA, "ASSUME"),
        act(companyA, conversation.id, cookieA2, "ASSUME"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("filtros da inbox por modo", async () => {
      const company = await createCompany(ctx.prisma, { name: "Empresa Filtros" });
      const cookie = await login(ctx.http, (await createMember(ctx.prisma, company.id)).email);
      const contact = await createContactRow(ctx.prisma, company.id);
      await createConversationRow(ctx.prisma, company.id, contact.id, { mode: "AI", inbound: ["x"] });
      await createConversationRow(ctx.prisma, company.id, contact.id, { mode: "HUMAN" });
      await createConversationRow(ctx.prisma, company.id, contact.id, { mode: "PAUSED" });
      const count = async (filter: string) =>
        ((await ctx.http.get(`${base(company)}?filter=${filter}`).set("Cookie", cookie)).body as Paginated<ConversationSummary>).total;
      expect(await count("all")).toBe(3);
      expect(await count("ai")).toBe(1);
      expect(await count("human")).toBe(1);
      expect(await count("paused")).toBe(1);
      expect(await count("unread")).toBe(1);
      expect((await ctx.http.get(`${base(company)}?filter=vip`).set("Cookie", cookie)).status).toBe(400);
    });
  });

  describe("[#8][#9] isolamento entre empresas", () => {
    it("lista da B não contém conversas da A, e vice-versa", async () => {
      const contactB = await createContactRow(ctx.prisma, companyB.id);
      const convB = await createConversationRow(ctx.prisma, companyB.id, contactB.id, { inbound: ["segredo da B"] });
      const listA = (await ctx.http.get(`${base(companyA)}?pageSize=50`).set("Cookie", cookieA)).body as Paginated<ConversationSummary>;
      expect(listA.items.some((c) => c.id === convB.id)).toBe(false);
      const listB = (await ctx.http.get(base(companyB)).set("Cookie", cookieB)).body as Paginated<ConversationSummary>;
      expect(listB.items.map((c) => c.id)).toEqual([convB.id]);
    });

    it("usuário da A não lê, não escreve e não muda modo de conversa da B", async () => {
      const contactB = await createContactRow(ctx.prisma, companyB.id);
      const convB = await createConversationRow(ctx.prisma, companyB.id, contactB.id, { mode: "HUMAN", inbound: ["confidencial"] });

      // Trocando o companyId da URL: o guard bloqueia.
      expect((await ctx.http.get(`${base(companyB)}/${convB.id}`).set("Cookie", cookieA)).status).toBe(403);
      expect((await ctx.http.get(`${base(companyB)}/${convB.id}/messages`).set("Cookie", cookieA)).status).toBe(403);
      expect((await post(`${base(companyB)}/${convB.id}/messages`, cookieA, { body: "x" })).status).toBe(403);

      // Mantendo o companyId da A e usando o ID da conversa da B: não existe para a A.
      const viaA = `${base(companyA)}/${convB.id}`;
      expect((await ctx.http.get(viaA).set("Cookie", cookieA)).status).toBe(404);
      expect((await ctx.http.get(`${viaA}/messages`).set("Cookie", cookieA)).status).toBe(404);
      expect((await post(`${viaA}/messages`, cookieA, { body: "invasão" })).status).toBe(404);
      expect((await post(`${viaA}/read`, cookieA)).status).toBe(404);
      expect((await act(companyA, convB.id, cookieA, "PAUSE")).status).toBe(404);

      const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: convB.id } });
      expect(row).toMatchObject({ mode: "HUMAN", unreadCount: 1 });
      expect(await ctx.prisma.message.count({ where: { conversationId: convB.id } })).toBe(1);
    });

    it("cursor de mensagem de outra conversa/empresa é recusado", async () => {
      const contactB = await createContactRow(ctx.prisma, companyB.id);
      const convB = await createConversationRow(ctx.prisma, companyB.id, contactB.id, { inbound: ["b1"] });
      const messageB = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: convB.id } });
      const convA = await createConversationRow(ctx.prisma, companyA.id, contactA.id, { inbound: ["a1"] });
      const response = await ctx.http
        .get(`${base(companyA)}/${convA.id}/messages?before=${messageB.id}`)
        .set("Cookie", cookieA);
      expect(response.status).toBe(400);
    });

    it("mensagem retornada não expõe dados de outra empresa", async () => {
      const conversation = (await post(base(companyA), cookieA, { contactId: contactA.id })).body as ConversationDetail;
      const sent = (await post(`${base(companyA)}/${conversation.id}/messages`, cookieA, { body: "ok" })).body as MessageItem;
      const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: sent.id } });
      expect(row.companyId).toBe(companyA.id);
    });
  });
});
