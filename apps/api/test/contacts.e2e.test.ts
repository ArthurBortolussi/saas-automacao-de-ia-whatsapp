import type { ApiError, ContactDetail, ContactSummary, Paginated } from "@arthur-ai/shared";
import type { Company } from "@arthur-ai/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCompany,
  createContactRow,
  createMember,
  createTestApp,
  createUser,
  login,
  ORIGIN,
  resetDatabase,
  type TestContext,
} from "./helpers.js";

describe("Contatos", () => {
  let ctx: TestContext;
  let companyA: Company;
  let companyB: Company;
  let cookieA: string;
  let cookieB: string;
  let agentCookieA: string;

  const base = (company: Company) => `/api/companies/${company.id}/contacts`;
  const post = (path: string, cookie: string, body: object) =>
    ctx.http.post(path).set("Origin", ORIGIN).set("Cookie", cookie).send(body);
  const patch = (path: string, cookie: string, body: object) =>
    ctx.http.patch(path).set("Origin", ORIGIN).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    companyA = await createCompany(ctx.prisma, { name: "Empresa A" });
    companyB = await createCompany(ctx.prisma, { name: "Empresa B" });
    cookieA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "OWNER" })).email);
    agentCookieA = await login(ctx.http, (await createMember(ctx.prisma, companyA.id, { role: "AGENT" })).email);
    cookieB = await login(ctx.http, (await createMember(ctx.prisma, companyB.id, { role: "OWNER" })).email);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("[#1] cadastro", () => {
    it("cria contato com telefone normalizado, defaults e auditoria", async () => {
      const response = await post(base(companyA), cookieA, {
        name: "Mariana Souza",
        phone: "(11) 98888-1111",
        email: " Mariana@Exemplo.COM ",
        notes: "Prefere contato à tarde.",
      });
      expect(response.status).toBe(201);
      const contact = response.body as ContactDetail;
      expect(contact).toMatchObject({
        name: "Mariana Souza",
        phone: "5511988881111",
        email: "mariana@exemplo.com",
        status: "NEW",
        source: "MANUAL",
        notes: "Prefere contato à tarde.",
      });
      const row = await ctx.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
      expect(row.companyId).toBe(companyA.id);
      expect(await ctx.prisma.auditLog.count({ where: { action: "contact.created", entityId: contact.id } })).toBe(1);
    });

    it("AGENT também cadastra contatos da própria empresa", async () => {
      const response = await post(base(companyA), agentCookieA, { name: "Cliente do Agente", phone: "11 97777-2222", status: "LEAD" });
      expect(response.status).toBe(201);
    });

    it("telefone duplicado na mesma empresa retorna 409, inclusive em outro formato", async () => {
      const first = await post(base(companyA), cookieA, { name: "Primeiro", phone: "(21) 99999-3333" });
      expect(first.status).toBe(201);
      const duplicate = await post(base(companyA), cookieA, { name: "Segundo", phone: "+55 21 99999-3333" });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as ApiError).message).toBe("Já existe um contato com este telefone nesta empresa.");
    });

    it("o mesmo telefone pode existir em empresas diferentes", async () => {
      const inA = await post(base(companyA), cookieA, { name: "Cliente em A", phone: "(31) 98888-4444" });
      const inB = await post(base(companyB), cookieB, { name: "Cliente em B", phone: "(31) 98888-4444" });
      expect(inA.status).toBe(201);
      expect(inB.status).toBe(201);
    });

    it("rejeita payload inválido (telefone, enum, campo extra, companyId no corpo)", async () => {
      const cases = [
        { name: "X Y", phone: "123" },
        { name: "X Y", phone: "11999990000", status: "VIP" },
        { name: "X Y", phone: "11999990000", source: "TELEPATIA" },
        { name: "X Y", phone: "11999990000", companyId: companyB.id },
      ];
      for (const body of cases) {
        const response = await post(base(companyA), cookieA, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });
  });

  describe("[#2] edição", () => {
    it("edita campos, limpa opcionais com valor vazio e audita", async () => {
      const contact = await createContactRow(ctx.prisma, companyA.id, "Para Editar");
      await ctx.prisma.contact.update({ where: { id: contact.id }, data: { email: "a@b.com", notes: "antiga" } });

      const response = await patch(`${base(companyA)}/${contact.id}`, cookieA, {
        name: "Editado",
        status: "CUSTOMER",
        source: "REFERRAL",
        email: "",
        notes: "Fechou contrato anual.",
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: "Editado",
        status: "CUSTOMER",
        source: "REFERRAL",
        email: null,
        notes: "Fechou contrato anual.",
      });
      expect(await ctx.prisma.auditLog.count({ where: { action: "contact.updated", entityId: contact.id } })).toBe(1);
    });

    it("editar para um telefone já usado na empresa retorna 409", async () => {
      const a = await createContactRow(ctx.prisma, companyA.id);
      const b = await createContactRow(ctx.prisma, companyA.id);
      const response = await patch(`${base(companyA)}/${b.id}`, cookieA, { phone: `+${a.phone}` });
      expect(response.status).toBe(409);
    });

    it("corpo vazio retorna 400", async () => {
      const contact = await createContactRow(ctx.prisma, companyA.id);
      expect((await patch(`${base(companyA)}/${contact.id}`, cookieA, {})).status).toBe(400);
    });
  });

  describe("[#3] pesquisa e paginação", () => {
    let company: Company;
    let cookie: string;

    beforeAll(async () => {
      company = await createCompany(ctx.prisma, { name: "Empresa Busca" });
      cookie = await login(ctx.http, (await createMember(ctx.prisma, company.id)).email);
      for (let i = 1; i <= 25; i++) {
        await ctx.prisma.contact.create({
          data: { companyId: company.id, name: `Cliente ${String(i).padStart(2, "0")}`, phone: `55119000000${String(i).padStart(2, "0")}` },
        });
      }
      await ctx.prisma.contact.create({ data: { companyId: company.id, name: "João Pereira", phone: "5521987654321", status: "LEAD" } });
    });

    const list = (query: string) => ctx.http.get(`${base(company)}?${query}`).set("Cookie", cookie);

    it("pesquisa por nome sem diferenciar maiúsculas", async () => {
      const body = (await list("q=joão")).body as Paginated<ContactSummary>;
      expect(body.total).toBe(1);
      expect(body.items[0]?.name).toBe("João Pereira");
    });

    it("pesquisa por telefone em qualquer formato", async () => {
      const formatted = (await list(`q=${encodeURIComponent("(21) 98765")}`)).body as Paginated<ContactSummary>;
      expect(formatted.items.map((c) => c.name)).toEqual(["João Pereira"]);
    });

    it("filtra por status", async () => {
      const body = (await list("status=LEAD")).body as Paginated<ContactSummary>;
      expect(body.total).toBe(1);
    });

    it("pagina com limite máximo no backend", async () => {
      const page1 = (await list("pageSize=10&page=1")).body as Paginated<ContactSummary>;
      const page3 = (await list("pageSize=10&page=3")).body as Paginated<ContactSummary>;
      expect(page1).toMatchObject({ total: 26, page: 1, pageSize: 10 });
      expect(page1.items).toHaveLength(10);
      expect(page3.items).toHaveLength(6);
      const ids = new Set([...page1.items, ...page3.items].map((c) => c.id));
      expect(ids.size).toBe(16);
      expect((await list("pageSize=500")).status).toBe(400);
    });

    it("sem resultados devolve lista vazia", async () => {
      const body = (await list("q=inexistente-xyz")).body as Paginated<ContactSummary>;
      expect(body).toMatchObject({ total: 0, items: [] });
    });
  });

  describe("[#8][#9] isolamento entre empresas", () => {
    it("listagem traz somente contatos da própria empresa", async () => {
      await createContactRow(ctx.prisma, companyB.id, "Segredo da B");
      const body = (await ctx.http.get(`${base(companyA)}?pageSize=50`).set("Cookie", cookieA)).body as Paginated<ContactSummary>;
      expect(body.items.some((c) => c.name === "Segredo da B")).toBe(false);
      const rows = await ctx.prisma.contact.findMany({ where: { id: { in: body.items.map((c) => c.id) } } });
      expect(rows.every((row) => row.companyId === companyA.id)).toBe(true);
    });

    it("usuário da A recebe 403 ao trocar o companyId da URL para a B", async () => {
      expect((await ctx.http.get(base(companyB)).set("Cookie", cookieA)).status).toBe(403);
      expect((await post(base(companyB), cookieA, { name: "Invasor", phone: "11955554444" })).status).toBe(403);
    });

    it("contato da B acessado pela URL da A responde 404, e nada é alterado", async () => {
      const secret = await createContactRow(ctx.prisma, companyB.id, "Contato da B");
      const path = `${base(companyA)}/${secret.id}`;
      expect((await ctx.http.get(path).set("Cookie", cookieA)).status).toBe(404);
      expect((await patch(path, cookieA, { name: "Hackeado" })).status).toBe(404);
      const row = await ctx.prisma.contact.findUniqueOrThrow({ where: { id: secret.id } });
      expect(row.name).toBe("Contato da B");
    });

    it("ID malformado retorna 400", async () => {
      expect((await ctx.http.get(`${base(companyA)}/nao-e-uuid`).set("Cookie", cookieA)).status).toBe(400);
    });

    it("sem sessão: 401", async () => {
      expect((await ctx.http.get(base(companyA))).status).toBe(401);
    });

    it("SUPERADMIN acessa contatos de qualquer empresa (suporte)", async () => {
      const admin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
      const cookie = await login(ctx.http, admin.email);
      expect((await ctx.http.get(base(companyB)).set("Cookie", cookie)).status).toBe(200);
    });
  });
});
