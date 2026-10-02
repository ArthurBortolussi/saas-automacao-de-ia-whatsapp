import type { Company, Conversation, ConversationCloseReason } from "@arthur-ai/database";
import type { AdminCompanyAnalytics, CompanyAnalyticsReport, PlatformAnalyticsReport } from "@arthur-ai/shared";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { ExportRateLimiter } from "../src/analytics/export-rate-limiter.js";
import { DistributionService } from "../src/team/distribution.service.js";
import { TeamWorker } from "../src/team/team-worker.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv, MockAnthropicApi, replyHandoff, replyText } from "./ai-helpers.js";
import {
  createCompany,
  createContactRow,
  createConversationRow,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  type TestContext,
} from "./helpers.js";
import { addMember, as, type MemberHandle } from "./team-helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE_A = "888888888888881";
const PHONE_B = "888888888888882";
const SP = "America/Sao_Paulo";

let customerSequence = 0;
const newCustomer = () => `55219${String(10_000_000 + (customerSequence += 1)).slice(-8)}`;

// ---------------------------------------------------------------- leitura do .xlsx exportado (sem dependências do código)

/** Linhas de uma aba: texto (compartilhado ou inline) ou número, por coluna. */
function sheetRows(xlsx: Buffer, sheetIndex: number): (string | number | null)[][] {
  const files = unzipSync(new Uint8Array(xlsx));
  const shared: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"];
  if (sharedXml) {
    for (const match of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1] ?? "")).join(""));
    }
  }
  const sheet = files[`xl/worksheets/sheet${sheetIndex}.xml`];
  if (!sheet) throw new Error(`aba ${sheetIndex} ausente`);
  const rows: (string | number | null)[][] = [];
  for (const row of strFromU8(sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: (string | number | null)[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = (cell[1] ?? "A").charCodeAt(0) - 65;
      const attributes = cell[2] ?? "";
      const inner = cell[3] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: string | number | null = null;
      if (attributes.includes('t="s"')) value = shared[Number(raw)] ?? null;
      else if (attributes.includes('t="inlineStr"')) value = decode(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "");
      else if (attributes.includes('t="str"')) value = decode(raw ?? "");
      else if (raw !== undefined) value = Number(raw);
      cells[column] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function decode(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

/** Valor da coluna "Valor" (C) da linha do resumo com este indicador. */
function summaryValue(xlsx: Buffer, label: string): string | number | null | undefined {
  return sheetRows(xlsx, 1).find((row) => row[1] === label)?.[2];
}

/** O supertest guarda respostas binárias em `body` quando o parser devolve Buffer. */
const binary = (res: { headers: Record<string, string>; body: unknown }) => res.body as Buffer;
type ResponseParser = Exclude<Parameters<ReturnType<TestContext["http"]["get"]>["parse"]>[0], (text: string) => unknown>;
const parseBinary: ResponseParser = (res, callback) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
};

describe("Fase 6: Analytics e relatórios", () => {
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
  let admin: MemberHandle;
  let agent: MemberHandle;
  let superCookie: string;

  const settle = async () => {
    await whatsapp.drain();
    await ai.drain();
    await team.drain();
  };
  const customerSays = async (from: string, text = "Olá", phoneNumberId = PHONE_A, wamid = nextWamid("wamid.IN")) => {
    const response = await postWebhook(ctx, inboundPayload({ phoneNumberId, from, wamid, text }));
    expect(response.status).toBe(200);
    await settle();
  };
  const conversationOf = (from: string): Promise<Conversation> => ctx.prisma.conversation.findFirstOrThrow({ where: { contact: { phone: from } } });
  const companyReport = async (cookie = owner.cookie, period = "last7days", company = companyA): Promise<CompanyAnalyticsReport> => {
    const response = await as(ctx, cookie).get(`/companies/${company.id}/analytics?period=${period}`);
    expect(response.status).toBe(200);
    return response.body as CompanyAnalyticsReport;
  };
  const platformReport = async (period = "last7days"): Promise<PlatformAnalyticsReport> => {
    const response = await as(ctx, superCookie).get(`/admin/analytics?period=${period}`);
    expect(response.status).toBe(200);
    return response.body as PlatformAnalyticsReport;
  };
  const download = (cookie: string, path: string) =>
    ctx.http.get(`/api${path}`).set("Cookie", cookie).buffer(true).parse(parseBinary);
  const aiMode = (company: Company, mode: "AI" | "HUMAN") =>
    ctx.prisma.aiSettings.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, enabled: true, defaultConversationMode: mode },
      update: { enabled: true, defaultConversationMode: mode },
    });
  /** Início de hoje (instante) no fuso informado, calculado pelo banco. */
  const startOfToday = async (timezone = SP): Promise<Date> => {
    const [row] = await ctx.prisma.$queryRaw<{ start: Date }[]>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) AS "start"`;
    if (!row) throw new Error("sem início do dia");
    return row.start;
  };
  /** Ciclo com horários controlados (dados de teste explícitos para períodos, fusos e médias). */
  const insertCycle = async (
    company: Company,
    data: {
      startedAt: Date;
      aiFirstAt?: Date;
      humanRequestedAt?: Date;
      firstQueuedAt?: Date;
      firstAssignedAt?: Date;
      firstHumanReplyAt?: Date;
      queueWaitMs?: number;
      queueWaitCount?: number;
      closedAt?: Date;
      closeReason?: ConversationCloseReason;
    },
  ) => {
    const contact = await createContactRow(ctx.prisma, company.id);
    const conversation = await createConversationRow(ctx.prisma, company.id, contact.id);
    return ctx.prisma.conversationCycle.create({
      data: {
        companyId: company.id,
        conversationId: conversation.id,
        origin: "NEW_CONVERSATION",
        startMode: "AI",
        ...data,
        queueWaitMs: BigInt(data.queueWaitMs ?? 0),
        queueWaitCount: data.queueWaitCount ?? 0,
      },
    });
  };
  const openCyclesInvariant = async () => {
    const conversations = await ctx.prisma.conversation.findMany({ include: { cycles: true } });
    for (const conversation of conversations) {
      const open = conversation.cycles.filter((cycle) => cycle.closedAt === null).length;
      if (conversation.cycles.length === 0) continue; // conversas criadas direto no banco pelos helpers
      expect(open).toBe(conversation.status === "CLOSED" ? 0 : 1);
    }
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
    companyA = await createCompany(ctx.prisma, { name: "Clínica Analytics" });
    companyB = await createCompany(ctx.prisma, { name: "Loja Vizinha" });
    await createAccountRow(ctx.prisma, companyA.id, PHONE_A);
    await createAccountRow(ctx.prisma, companyB.id, PHONE_B);
    owner = await addMember(ctx, companyA.id, { role: "OWNER" });
    admin = await addMember(ctx, companyA.id, { role: "ADMIN" });
    agent = await addMember(ctx, companyA.id, { role: "AGENT" });
    const superadmin = await createUser(ctx.prisma, { globalRole: "SUPERADMIN" });
    superCookie = await login(ctx.http, superadmin.email);
  });

  afterAll(async () => {
    await settle();
    await ctx.app.close();
    await graph.stop();
    await anthropic.stop();
    for (const fn of restore.reverse()) fn();
  });

  // ---------------------------------------------------------------- permissões e isolamento

  describe("[#1-#6] permissões, isolamento e dados financeiros", () => {
    it("[#2 #3] proprietário e administrador consultam o Analytics da própria empresa", async () => {
      for (const member of [owner, admin]) {
        const report = await companyReport(member.cookie);
        expect(report.scope).toBe("company");
        expect(report.company).toEqual({ id: companyA.id, name: "Clínica Analytics" });
        expect(report.period.timezone).toBe(SP);
      }
    });

    it("[#4] funcionário comum é recusado no backend (relatório e exportações)", async () => {
      const responses = await Promise.all([
        as(ctx, agent.cookie).get(`/companies/${companyA.id}/analytics`),
        as(ctx, agent.cookie).get(`/companies/${companyA.id}/analytics/export?format=pdf`),
        as(ctx, agent.cookie).get(`/companies/${companyA.id}/analytics/export?format=xlsx`),
        as(ctx, agent.cookie).get(`/admin/analytics`),
      ]);
      for (const response of responses) expect(response.status).toBe(403);
    });

    it("[#1] somente o SUPERADMIN acessa o Analytics da plataforma e a consulta por empresa", async () => {
      expect((await as(ctx, superCookie).get("/admin/analytics")).status).toBe(200);
      expect((await as(ctx, superCookie).get(`/admin/analytics/companies/${companyA.id}`)).status).toBe(200);
      for (const member of [owner, admin, agent]) {
        expect((await as(ctx, member.cookie).get("/admin/analytics")).status).toBe(403);
        expect((await as(ctx, member.cookie).get("/admin/analytics/export?format=xlsx")).status).toBe(403);
        expect((await as(ctx, member.cookie).get(`/admin/analytics/companies/${companyA.id}`)).status).toBe(403);
      }
      expect((await ctx.http.get("/api/admin/analytics")).status).toBe(401);
      expect((await ctx.http.get(`/api/companies/${companyA.id}/analytics`)).status).toBe(401);
    });

    it("[#5] empresa alheia ou inexistente: 403, e os números são só da própria empresa", async () => {
      await aiMode(companyA, "AI");
      await aiMode(companyB, "AI");
      await customerSays(newCustomer(), "Olá A");
      await customerSays(newCustomer(), "Olá B", PHONE_B);
      await customerSays(newCustomer(), "Olá B de novo", PHONE_B);

      expect((await as(ctx, owner.cookie).get(`/companies/${companyB.id}/analytics`)).status).toBe(403);
      expect((await as(ctx, owner.cookie).get(`/companies/${companyB.id}/analytics/export?format=pdf`)).status).toBe(403);
      expect((await as(ctx, owner.cookie).get(`/companies/00000000-0000-7000-8000-000000000000/analytics`)).status).toBe(403);
      // Parâmetros extras (ex.: tentar escolher outra empresa) são recusados pela validação estrita.
      expect((await as(ctx, owner.cookie).get(`/companies/${companyA.id}/analytics?companyId=${companyB.id}`)).status).toBe(400);

      expect((await companyReport()).cycles.started).toBe(1);
      const ownerB = await addMember(ctx, companyB.id, { role: "OWNER" });
      expect((await companyReport(ownerB.cookie, "last7days", companyB)).cycles.started).toBe(2);
      expect((await platformReport()).cycles.started).toBe(3);
      const adminView = (await as(ctx, superCookie).get(`/admin/analytics/companies/${companyB.id}`)).body as AdminCompanyAnalytics;
      expect(adminView.cycles.started).toBe(2);
      expect(adminView.company.id).toBe(companyB.id);
    });

    it("[#6] o relatório da empresa não contém consumo nem custos da IA (resposta e exportação)", async () => {
      await aiMode(companyA, "AI");
      anthropic.respondWith(() => replyText("Olá!", { input_tokens: 1234, output_tokens: 56 }));
      await customerSays(newCustomer());
      expect(await ctx.prisma.aiRun.count()).toBe(1);

      const raw = JSON.stringify(await companyReport());
      for (const forbidden of ["cost", "Cost", "token", "Token", "usd", "Usd", "USD", "aiRuns", "1234"]) expect(raw).not.toContain(forbidden);

      const xlsx = await download(owner.cookie, `/companies/${companyA.id}/analytics/export?format=xlsx`);
      expect(xlsx.status).toBe(200);
      const text = sheetRows(binary(xlsx), 1).flat().join(" ") + sheetRows(binary(xlsx), 3).flat().join(" ");
      for (const forbidden of ["Custo", "custo", "Token", "token", "US$", "USD"]) expect(text).not.toContain(forbidden);
      // A empresa também não vê a aba Uso do SUPERADMIN.
      expect((await as(ctx, owner.cookie).get(`/admin/companies/${companyA.id}/ai/usage`)).status).toBe(403);
    });

    it("valida o período e o instante de referência", async () => {
      const base = `/companies/${companyA.id}/analytics`;
      expect((await as(ctx, owner.cookie).get(`${base}?period=last90days`)).status).toBe(400);
      expect((await as(ctx, owner.cookie).get(`${base}?period=today&extra=1`)).status).toBe(400);
      expect((await as(ctx, owner.cookie).get(`${base}?at=ontem`)).status).toBe(400);
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      expect((await as(ctx, owner.cookie).get(`${base}?at=${future}`)).status).toBe(400);
      const old = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
      expect((await as(ctx, owner.cookie).get(`${base}?at=${old}`)).status).toBe(400);
      expect((await as(ctx, owner.cookie).get(`${base}/export?format=csv`)).status).toBe(400);
      expect((await as(ctx, owner.cookie).get(`${base}/export`)).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- períodos e fuso

  describe("[#7 #8] períodos de calendário e fuso horário", () => {
    it("[#7] hoje, últimos 7 e últimos 30 dias incluem o dia atual e os dias anteriores corretos", async () => {
      const today = await startOfToday();
      const day = 24 * 60 * 60_000;
      await insertCycle(companyA, { startedAt: today });
      await insertCycle(companyA, { startedAt: new Date(today.getTime() - 6 * day + 60_000) });
      await insertCycle(companyA, { startedAt: new Date(today.getTime() - 7 * day + 60_000) });
      await insertCycle(companyA, { startedAt: new Date(today.getTime() - 29 * day + 60_000) });
      await insertCycle(companyA, { startedAt: new Date(today.getTime() - 30 * day + 60_000) });

      const todayReport = await companyReport(owner.cookie, "today");
      const week = await companyReport(owner.cookie, "last7days");
      const month = await companyReport(owner.cookie, "last30days");
      expect(todayReport.cycles.started).toBe(1);
      expect(week.cycles.started).toBe(2);
      expect(month.cycles.started).toBe(4);
      expect(todayReport.period.days).toHaveLength(1);
      expect(week.period.days).toHaveLength(7);
      expect(month.period.days).toHaveLength(30);
      expect(new Date(todayReport.period.from).getTime()).toBe(today.getTime());
      // Gráfico e cards usam o mesmo recorte.
      expect(month.daily.reduce((sum, point) => sum + point.started, 0)).toBe(month.cycles.started);
    });

    it("[#8] agrupa por data no fuso America/Sao_Paulo (virada do dia)", async () => {
      const today = await startOfToday();
      // 23h30 de ontem em São Paulo = 02h30 de hoje em UTC: conta como ONTEM.
      await insertCycle(companyA, { startedAt: new Date(today.getTime() - 30 * 60_000) });
      await insertCycle(companyA, { startedAt: today });

      const week = await companyReport(owner.cookie, "last7days");
      const [yesterday, todayKey] = week.period.days.slice(-2);
      const byDay = Object.fromEntries(week.daily.map((point) => [point.date, point.started]));
      expect(byDay[yesterday ?? ""]).toBe(1);
      expect(byDay[todayKey ?? ""]).toBe(1);
      expect((await companyReport(owner.cookie, "today")).cycles.started).toBe(1);
      const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date());
      expect(todayKey).toBe(localToday);
    });

    it("usa o fuso cadastrado da empresa; o SUPERADMIN usa o fuso de referência da plataforma", async () => {
      await ctx.prisma.company.update({ where: { id: companyA.id }, data: { timezone: "Asia/Tokyo" } });
      const tokyoToday = await startOfToday("Asia/Tokyo");
      await insertCycle(companyA, { startedAt: tokyoToday });
      const report = await companyReport(owner.cookie, "today");
      expect(report.period.timezone).toBe("Asia/Tokyo");
      expect(new Date(report.period.from).getTime()).toBe(tokyoToday.getTime());
      expect(report.cycles.started).toBe(1);
      expect((await platformReport("today")).period.timezone).toBe(SP);
    });
  });

  // ---------------------------------------------------------------- ciclos pelos fluxos reais

  describe("[#9-#24] atendimentos medidos pelos fluxos reais", () => {
    it("[#9 #13 #24] atendimento iniciado e conduzido só pela IA; webhook duplicado não duplica nada", async () => {
      await aiMode(companyA, "AI");
      const from = newCustomer();
      const wamid = nextWamid("wamid.IN");
      await customerSays(from, "Qual o horário?", PHONE_A, wamid);
      await customerSays(from, "Qual o horário?", PHONE_A, wamid); // reenvio idêntico da Meta

      const report = await companyReport();
      expect(report.cycles).toMatchObject({ started: 1, aiOnlyOpen: 1, aiOnlyClosed: 0, withHuman: 0, awaitingHuman: 0, aiTransferred: 0 });
      expect(report.current).toMatchObject({ inProgress: 1, withAi: 1, queued: 0 });
      expect(report.team.firstResponse).toEqual({ averageSeconds: null, samples: 0 });
      const platform = await platformReport();
      expect(platform.messages).toMatchObject({ inbound: 1, outboundAi: 1, outboundAgent: 0 });
      expect(await ctx.prisma.conversationCycle.count()).toBe(1);
    });

    it("[#14 #18 #19 #20 #21] transferência da IA, fila, atribuição e primeira resposta humana (sem contar a IA)", async () => {
      await aiMode(companyA, "AI");
      anthropic.respondWith(() => replyHandoff("cliente_pediu"));
      const from = newCustomer();
      await customerSays(from, "Quero falar com uma pessoa");
      const conversation = await conversationOf(from);
      expect(conversation).toMatchObject({ mode: "HUMAN", status: "QUEUED" });

      // Na fila: transferido, sem intervenção humana ainda (entrar na fila não é atendimento humano).
      let report = await companyReport();
      expect(report.cycles).toMatchObject({ started: 1, awaitingHuman: 1, withHuman: 0, aiOnlyOpen: 0, aiTransferred: 1 });
      expect(report.current.queued).toBe(1);
      expect(report.team.withoutHumanReply).toBe(1);
      expect(report.team.queueWait).toEqual({ averageSeconds: null, samples: 0 });
      expect(report.team.firstResponse).toEqual({ averageSeconds: null, samples: 0 });

      await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
      await settle();
      expect(await conversationOf(from)).toMatchObject({ status: "ASSIGNED", assignedUserId: agent.id });
      const sent = await as(ctx, agent.cookie).post(`/companies/${companyA.id}/conversations/${conversation.id}/messages`, { body: "Oi! Sou a Ana." });
      expect(sent.status).toBe(201);
      await settle();

      const cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
      const agentMessage = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, senderType: "AGENT" } });
      const aiMessage = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, senderType: "AI" } });
      expect(cycle.firstHumanReplyAt?.getTime()).toBe(agentMessage.createdAt.getTime());
      expect(cycle.aiFirstAt?.getTime()).toBeLessThanOrEqual(aiMessage.createdAt.getTime());
      expect(cycle.queueWaitCount).toBe(1);

      report = await companyReport();
      expect(report.cycles).toMatchObject({ started: 1, withHuman: 1, awaitingHuman: 0, aiOnlyOpen: 0, aiTransferred: 1 });
      expect(report.team.firstResponse.samples).toBe(1);
      const expectedFrt = ((cycle.firstHumanReplyAt?.getTime() ?? 0) - (cycle.humanRequestedAt?.getTime() ?? 0)) / 1000;
      expect(report.team.firstResponse.averageSeconds).toBeCloseTo(expectedFrt, 3);
      expect(report.team.queueWait.samples).toBe(1);
      expect(report.team.queueWait.averageSeconds).toBeCloseTo(Number(cycle.queueWaitMs) / 1000, 3);
      expect(report.team.withoutHumanReply).toBe(0);
      expect(report.current).toMatchObject({ withAgent: 1, queued: 0 });
      expect(report.team.humanInProgress).toBe(1);
    });

    it("[#18 #20] médias exatas: primeira resposta e espera na fila por atendimento", async () => {
      const base = new Date(Date.now() - 2 * 60 * 60_000);
      const plus = (seconds: number) => new Date(base.getTime() + seconds * 1000);
      await insertCycle(companyA, {
        startedAt: base,
        humanRequestedAt: base,
        firstQueuedAt: base,
        firstAssignedAt: plus(30),
        firstHumanReplyAt: plus(60),
        queueWaitMs: 30_000,
        queueWaitCount: 1,
      });
      // Duas esperas concluídas no mesmo atendimento: somadas (60 s + 30 s = 90 s).
      await insertCycle(companyA, {
        startedAt: base,
        humanRequestedAt: base,
        firstQueuedAt: base,
        firstAssignedAt: plus(60),
        firstHumanReplyAt: plus(180),
        queueWaitMs: 90_000,
        queueWaitCount: 2,
      });
      // Pedido sem resposta: fora da média, contado à parte.
      await insertCycle(companyA, { startedAt: base, humanRequestedAt: base, firstQueuedAt: base });
      // Resposta da IA não entra em nenhuma média humana.
      await insertCycle(companyA, { startedAt: base, aiFirstAt: plus(5) });

      const report = await companyReport();
      expect(report.team.firstResponse).toEqual({ averageSeconds: 120, samples: 2 });
      expect(report.team.queueWait).toEqual({ averageSeconds: 60, samples: 2 });
      expect(report.team.withoutHumanReply).toBe(1);
      expect(report.cycles).toMatchObject({ started: 4, withHuman: 2, awaitingHuman: 1, aiOnlyOpen: 1 });
    });

    it("[#15] transferência entre funcionários não duplica o atendimento", async () => {
      await aiMode(companyA, "HUMAN");
      await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
      const second = await addMember(ctx, companyA.id, { role: "AGENT", availability: "AVAILABLE" });
      const from = newCustomer();
      await customerSays(from);
      const conversation = await conversationOf(from);
      const target = conversation.assignedUserId === agent.id ? second : agent;
      const moved = await as(ctx, owner.cookie).post(`/companies/${companyA.id}/conversations/${conversation.id}/transfer`, { toUserId: target.id });
      expect(moved.status).toBe(200);
      expect(await ctx.prisma.conversationAssignment.count({ where: { conversationId: conversation.id } })).toBe(2);

      const report = await companyReport();
      expect(report.cycles).toMatchObject({ started: 1, withHuman: 1 });
      expect(report.team.humanCycles).toBe(1);
      const cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(cycle.queueWaitCount).toBe(1); // a transferência não abriu nova espera
    });

    it("[#10 #11 #12 #16] encerramento manual, reabertura na mesma conversa e múltiplos ciclos", async () => {
      await aiMode(companyA, "HUMAN");
      await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
      const from = newCustomer();
      await customerSays(from, "Primeiro contato");
      const conversation = await conversationOf(from);
      expect((await as(ctx, agent.cookie).post(`/companies/${companyA.id}/conversations/${conversation.id}/close`)).status).toBe(200);

      let report = await companyReport();
      expect(report.closed).toMatchObject({ total: 1, manual: 1, inactivity: 0, withHuman: 1 });
      expect(report.current.inProgress).toBe(0);

      await customerSays(from, "Voltei");
      expect((await conversationOf(from)).id).toBe(conversation.id);
      const cycles = await ctx.prisma.conversationCycle.findMany({ where: { conversationId: conversation.id }, orderBy: { startedAt: "asc" } });
      expect(cycles.map((cycle) => cycle.origin)).toEqual(["NEW_CONVERSATION", "REOPENED"]);
      expect(cycles[0]?.closeReason).toBe("MANUAL");
      expect(cycles[1]?.closedAt).toBeNull();

      report = await companyReport();
      expect(report.cycles.started).toBe(2);
      expect(report.closed.total).toBe(1); // o encerramento anterior continua contado
      expect(report.current.inProgress).toBe(1);
      expect(report.daily.reduce((sum, point) => sum + point.closed, 0)).toBe(1);
      await openCyclesInvariant();
    });

    it("[#10] encerramento automático por inatividade é contado separadamente", async () => {
      await aiMode(companyA, "HUMAN");
      await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
      const from = newCustomer();
      await customerSays(from);
      const conversation = await conversationOf(from);
      await ctx.prisma.teamSettings.create({ data: { companyId: companyA.id, inactivityTimeoutMinutes: 5 } });
      await ctx.prisma.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date(Date.now() - 10 * 60_000) } });
      expect(await distribution.closeInactive()).toBe(1);

      const report = await companyReport();
      expect(report.closed).toMatchObject({ total: 1, manual: 0, inactivity: 1 });
      const cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(cycle.closeReason).toBe("INACTIVITY");
    });

    it("[#17 #21] fila atual e pedidos ainda sem resposta (sem valor artificial na média)", async () => {
      await aiMode(companyA, "HUMAN");
      await customerSays(newCustomer());
      await customerSays(newCustomer());
      const report = await companyReport();
      expect(report.current).toMatchObject({ queued: 2, inProgress: 2, withAgent: 0 });
      expect(report.cycles).toMatchObject({ started: 2, awaitingHuman: 2, withHuman: 0 });
      expect(report.team.withoutHumanReply).toBe(2);
      expect(report.team.queueWait.averageSeconds).toBeNull();
      expect(report.team.firstResponse.averageSeconds).toBeNull();
    });

    it("[#22] sem dados: zeros nas contagens, médias nulas e série diária completa", async () => {
      const report = await companyReport(owner.cookie, "last30days");
      expect(report.cycles.started).toBe(0);
      expect(report.closed.total).toBe(0);
      expect(report.team.firstResponse).toEqual({ averageSeconds: null, samples: 0 });
      expect(report.team.queueWait).toEqual({ averageSeconds: null, samples: 0 });
      expect(report.daily).toHaveLength(30);
      expect(report.daily.every((point) => point.started === 0 && point.closed === 0)).toBe(true);
      const xlsx = await download(owner.cookie, `/companies/${companyA.id}/analytics/export?format=xlsx&period=last30days`);
      expect(summaryValue(binary(xlsx), "Tempo médio de primeira resposta humana")).toBe("Sem dados");
    });

    it("[#23] mensagens recebidas e enviadas por origem (IA, equipe, sistema)", async () => {
      await aiMode(companyA, "AI");
      anthropic.respondWith(() => replyHandoff("cliente_pediu"));
      const from = newCustomer();
      await customerSays(from, "Uma pessoa, por favor");
      await customerSays(from, "Alguém?");
      // Aviso de fila (SYSTEM) enviado pelo worker da equipe.
      const platform = await platformReport();
      expect(platform.messages.inbound).toBe(2);
      expect(platform.messages.outboundAi).toBe(1);
      expect(platform.messages.outboundSystem).toBe(1);
      expect(platform.messages.outboundAgent).toBe(0);
    });
  });

  // ---------------------------------------------------------------- consumo e custos (SUPERADMIN)

  describe("[#25-#28] consumo e custos estimados da IA", () => {
    it("[#25 #26 #27] agrega tokens e custo por origem; simulador e registros antigos nunca viram custo oficial", async () => {
      await aiMode(companyA, "AI");
      anthropic.respondWith(() => replyText("Olá!", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000 }));
      await customerSays(newCustomer());
      const run = await ctx.prisma.aiRun.findFirstOrThrow();
      expect(run.apiSource).toBe("SIMULATED"); // ANTHROPIC_BASE_URL do teste não é a API oficial
      expect(run.cycleId).not.toBeNull();
      expect(run.costUsd?.toFixed(6)).toBe("0.003400"); // 1000×2 + 100×10 + 2000×0,2 por milhão

      // Registro anterior à Fase 6 (origem nula) e um registro oficial com custo conhecido.
      const contact = await createContactRow(ctx.prisma, companyA.id);
      const legacyConversation = await createConversationRow(ctx.prisma, companyA.id, contact.id);
      await ctx.prisma.aiRun.create({
        data: { id: crypto.randomUUID(), companyId: companyA.id, conversationId: legacyConversation.id, model: "claude-sonnet-5-5", result: "REPLIED", inputTokens: 500, outputTokens: 50, costUsd: "0.001500", messageCount: 1 },
      });
      const officialCycle = await insertCycle(companyA, { startedAt: new Date(), aiFirstAt: new Date() });
      for (const cost of ["0.010000", "0.020000"]) {
        await ctx.prisma.aiRun.create({
          data: {
            id: crypto.randomUUID(),
            companyId: companyA.id,
            conversationId: officialCycle.conversationId,
            cycleId: officialCycle.id,
            apiSource: "OFFICIAL",
            model: "claude-sonnet-5-5",
            result: "REPLIED",
            inputTokens: 100,
            outputTokens: 10,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUsd: cost,
            messageCount: 1,
          },
        });
      }
      // Erro sem consumo: conta como execução, fora da soma de custo.
      await ctx.prisma.aiRun.create({
        data: { id: crypto.randomUUID(), companyId: companyA.id, conversationId: officialCycle.conversationId, cycleId: officialCycle.id, apiSource: "OFFICIAL", model: "claude-sonnet-5-5", result: "ERROR", messageCount: 1 },
      });

      const report = await platformReport();
      const bucket = (source: string) => report.ai.bySource.find((item) => item.source === source);
      expect(report.ai.currency).toBe("USD");
      expect(bucket("OFFICIAL")).toMatchObject({
        runs: 3,
        inputTokens: 200,
        outputTokens: 20,
        estimatedCostUsd: "0.030000",
        runsWithoutCost: 1,
        cyclesWithCost: 1,
        averageCostPerCycleUsd: "0.030000",
      });
      expect(bucket("SIMULATED")).toMatchObject({ runs: 1, inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 2000, estimatedCostUsd: "0.003400", cyclesWithCost: 1 });
      expect(bucket("UNVERIFIED")).toMatchObject({ runs: 1, estimatedCostUsd: "0.001500", cyclesWithCost: 0, averageCostPerCycleUsd: null });

      // A aba Uso (Fase 4) mostra os mesmos números, separados pela mesma regra.
      const usage = await as(ctx, superCookie).get(`/admin/companies/${companyA.id}/ai/usage?period=last7days`);
      expect(usage.status).toBe(200);
      expect((usage.body as { bySource: unknown }).bySource).toEqual(report.ai.bySource);
      expect((usage.body as { runs: number }).runs).toBe(5);
    });

    it("[#28] custo consolidado por empresa, sem misturar empresas", async () => {
      const cycleA = await insertCycle(companyA, { startedAt: new Date() });
      const cycleB = await insertCycle(companyB, { startedAt: new Date() });
      const run = (company: Company, cycle: typeof cycleA, cost: string, source: "OFFICIAL" | "SIMULATED") =>
        ctx.prisma.aiRun.create({
          data: {
            id: crypto.randomUUID(),
            companyId: company.id,
            conversationId: cycle.conversationId,
            cycleId: cycle.id,
            apiSource: source,
            model: "claude-sonnet-5-5",
            result: "REPLIED",
            inputTokens: 10,
            outputTokens: 5,
            cacheCreationInputTokens: 1,
            cacheReadInputTokens: 2,
            costUsd: cost,
            messageCount: 1,
          },
        });
      await run(companyA, cycleA, "0.100000", "OFFICIAL");
      await run(companyA, cycleA, "0.050000", "SIMULATED");
      await run(companyB, cycleB, "0.200000", "OFFICIAL");

      const report = await platformReport();
      const rowA = report.byCompany.find((row) => row.companyId === companyA.id);
      const rowB = report.byCompany.find((row) => row.companyId === companyB.id);
      expect(rowA).toMatchObject({ cyclesStarted: 1, aiRuns: 2, totalTokens: 36, costOfficialUsd: "0.100000", costNotOfficialUsd: "0.050000" });
      expect(rowB).toMatchObject({ cyclesStarted: 1, aiRuns: 1, totalTokens: 18, costOfficialUsd: "0.200000", costNotOfficialUsd: "0.000000" });
      expect(report.byCompany[0]?.companyId).toBe(companyB.id); // maior custo oficial primeiro
      expect(report.companies).toEqual({ total: 2, withActivity: 2 });

      const viewA = (await as(ctx, superCookie).get(`/admin/analytics/companies/${companyA.id}`)).body as AdminCompanyAnalytics;
      expect(viewA.ai.bySource.find((item) => item.source === "OFFICIAL")?.estimatedCostUsd).toBe("0.100000");
      expect(viewA.cycles.started).toBe(1);
    });
  });

  // ---------------------------------------------------------------- exportações

  describe("[#29-#32] exportações em PDF e Excel", () => {
    it("[#29] PDF: arquivo válido com cabeçalhos de download seguros", async () => {
      const response = await download(owner.cookie, `/companies/${companyA.id}/analytics/export?format=pdf&period=today`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="analytics-clinica-analytics-today-\d{4}-\d{2}-\d{2}\.pdf"$/);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      const pdf = binary(response);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");
      expect(Number(response.headers["content-length"])).toBe(pdf.length);
      expect(await ctx.prisma.auditLog.count({ where: { action: "analytics.exported", companyId: companyA.id } })).toBe(1);

      const platform = await download(superCookie, `/admin/analytics/export?format=pdf`);
      expect(platform.status).toBe(200);
      expect(binary(platform).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("[#30] Excel: abas de resumo, diário e notas, com números reais nas células", async () => {
      await aiMode(companyA, "AI");
      await customerSays(newCustomer());
      const response = await download(owner.cookie, `/companies/${companyA.id}/analytics/export?format=xlsx&period=last7days`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(response.headers["content-disposition"]).toMatch(/\.xlsx"$/);
      const xlsx = binary(response);
      const workbook = strFromU8(unzipSync(new Uint8Array(xlsx))["xl/workbook.xml"] ?? new Uint8Array());
      expect(workbook).toContain('name="Resumo"');
      expect(workbook).toContain('name="Diário"');
      expect(workbook).toContain('name="Notas"');
      expect(summaryValue(xlsx, "Atendimentos iniciados")).toBe(1);
      expect(summaryValue(xlsx, "Atendidos somente pela IA (em andamento)")).toBe(1);
      const daily = sheetRows(xlsx, 2);
      expect(daily[0]).toEqual(["Dia", "Iniciados", "Somente IA", "Com atendimento humano", "Encerrados"]);
      expect(daily).toHaveLength(8);
      expect(typeof daily[1]?.[0]).toBe("number"); // data como data do Excel, não texto

      const platform = await download(superCookie, `/admin/analytics/export?format=xlsx`);
      const names = strFromU8(unzipSync(new Uint8Array(binary(platform)))["xl/workbook.xml"] ?? new Uint8Array());
      expect(names).toContain('name="Consumo IA"');
      expect(names).toContain('name="Por empresa"');
    });

    it("[#31] exportações protegidas: perfil, empresa, sessão e limite de abuso", async () => {
      expect((await download(agent.cookie, `/companies/${companyA.id}/analytics/export?format=xlsx`)).status).toBe(403);
      expect((await download(owner.cookie, `/companies/${companyB.id}/analytics/export?format=xlsx`)).status).toBe(403);
      expect((await download(owner.cookie, `/admin/analytics/export?format=xlsx`)).status).toBe(403);
      expect((await ctx.http.get(`/api/companies/${companyA.id}/analytics/export?format=pdf`)).status).toBe(401);

      const limiter = new ExportRateLimiter();
      for (let index = 0; index < 20; index += 1) limiter.consume("user-1", 1000);
      expect(() => {
        limiter.consume("user-1", 1000);
      }).toThrow(/Muitas exportações/);
      expect(() => {
        limiter.consume("user-2", 1000);
      }).not.toThrow();
      expect(() => {
        limiter.consume("user-1", 1000 + 10 * 60_000);
      }).not.toThrow();
    });

    it("[#32] exportação com o mesmo instante de referência reproduz os números da tela", async () => {
      await aiMode(companyA, "AI");
      await customerSays(newCustomer());
      const report = await companyReport();
      // Depois da consulta, chegam novos atendimentos: não entram no arquivo com o mesmo instante de referência.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await customerSays(newCustomer());
      await customerSays(newCustomer());

      const at = encodeURIComponent(report.generatedAt);
      const xlsx = binary(await download(owner.cookie, `/companies/${companyA.id}/analytics/export?format=xlsx&period=last7days&at=${at}`));
      expect(summaryValue(xlsx, "Atendimentos iniciados")).toBe(report.cycles.started);
      expect(summaryValue(xlsx, "Atendidos somente pela IA (em andamento)")).toBe(report.cycles.aiOnlyOpen);
      expect(summaryValue(xlsx, "Atendimentos encerrados")).toBe(report.closed.total);
      const again = await as(ctx, owner.cookie).get(`/companies/${companyA.id}/analytics?period=last7days&at=${at}`);
      expect((again.body as CompanyAnalyticsReport).cycles).toEqual(report.cycles);
      expect((again.body as CompanyAnalyticsReport).daily).toEqual(report.daily);
      // Sem instante de referência, o relatório novo já vê os três.
      expect((await companyReport()).cycles.started).toBe(3);
    });
  });

  // ---------------------------------------------------------------- concorrência e compatibilidade

  describe("[#33 #34] eventos simultâneos e compatibilidade", () => {
    it("[#33] mensagens simultâneas de vários clientes e distribuição concorrente: um ciclo por conversa", async () => {
      await aiMode(companyA, "HUMAN");
      await ctx.prisma.companyMember.update({
        where: { companyId_userId: { companyId: companyA.id, userId: agent.id } },
        data: { availability: "AVAILABLE", maxConcurrent: 2 },
      });
      const customers = Array.from({ length: 6 }, () => newCustomer());
      const responses = await Promise.all(
        customers.map((from) => postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from, wamid: nextWamid("wamid.IN"), text: "Oi" }))),
      );
      for (const response of responses) expect(response.status).toBe(200);
      await Promise.all([whatsapp.drain(), whatsapp.drain()]);
      await Promise.all([team.drain(), distribution.distribute(companyA.id), distribution.distribute(companyA.id)]);
      await settle();

      expect(await ctx.prisma.conversationCycle.count()).toBe(6);
      const report = await companyReport();
      expect(report.cycles).toMatchObject({ started: 6, withHuman: 2, awaitingHuman: 4 });
      expect(report.current).toMatchObject({ withAgent: 2, queued: 4 });
      await openCyclesInvariant();
    });

    it("[#33] encerramento e nova mensagem do cliente ao mesmo tempo mantêm os ciclos consistentes", async () => {
      await aiMode(companyA, "HUMAN");
      await as(ctx, agent.cookie).patch(`/companies/${companyA.id}/team/me/availability`, { availability: "AVAILABLE" });
      const from = newCustomer();
      await customerSays(from);
      const conversation = await conversationOf(from);
      const [closed, webhook] = await Promise.all([
        as(ctx, owner.cookie).post(`/companies/${companyA.id}/conversations/${conversation.id}/close`),
        postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE_A, from, wamid: nextWamid("wamid.IN"), text: "Ainda aqui" })),
      ]);
      expect(webhook.status).toBe(200);
      expect([200, 409]).toContain(closed.status);
      await settle();
      await openCyclesInvariant();
      const report = await companyReport();
      const cycles = await ctx.prisma.conversationCycle.count({ where: { conversationId: conversation.id } });
      expect(report.cycles.started).toBe(cycles);
      expect(report.closed.total).toBe(await ctx.prisma.conversationCycle.count({ where: { closedAt: { not: null } } }));
    });

    it("[#34] fluxos das Fases 2 a 5 continuam iguais com os marcos de ciclo (devolver à IA, assumir, pausar)", async () => {
      await aiMode(companyA, "HUMAN");
      const from = newCustomer();
      await customerSays(from);
      const conversation = await conversationOf(from);
      const path = `/companies/${companyA.id}/conversations/${conversation.id}/mode`;
      expect((await as(ctx, owner.cookie).post(path, { action: "RETURN_TO_AI" })).status).toBe(200);
      let cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(cycle.queueEnteredAt).toBeNull(); // saiu da fila sem atendimento: espera descartada
      expect(cycle.queueWaitCount).toBe(0);

      expect((await as(ctx, agent.cookie).post(path, { action: "ASSUME" })).status).toBe(200);
      expect((await as(ctx, agent.cookie).post(path, { action: "PAUSE" })).status).toBe(200);
      expect((await as(ctx, agent.cookie).post(path, { action: "RESUME" })).status).toBe(200);
      cycle = await ctx.prisma.conversationCycle.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(cycle.firstAssignedAt).not.toBeNull();
      const report = await companyReport();
      // Devolvida à IA e assumida depois: o histórico completo vale (teve participação humana).
      expect(report.cycles).toMatchObject({ started: 1, withHuman: 1, awaitingHuman: 0 });

      // Conversa interna criada pelo painel também é um atendimento (com responsável desde o início).
      const contact = await createContactRow(ctx.prisma, companyA.id);
      expect((await as(ctx, agent.cookie).post(`/companies/${companyA.id}/conversations`, { contactId: contact.id })).status).toBe(201);
      expect((await companyReport()).cycles).toMatchObject({ started: 2, withHuman: 2 });
      await openCyclesInvariant();
    });
  });
});
