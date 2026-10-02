import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { Company } from "@arthur-ai/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiWorker } from "../src/ai/ai-worker.service.js";
import { WhatsAppWorker } from "../src/whatsapp/whatsapp-worker.service.js";
import { enableAiEnv } from "./ai-helpers.js";
import { createCompany, createMember, createTestApp, login, ORIGIN, resetDatabase, type TestContext } from "./helpers.js";
import { createAccountRow, enableWhatsAppEnv, inboundPayload, MockGraphApi, nextWamid, postWebhook } from "./whatsapp-helpers.js";

const PHONE = "555555555555555";
const CUSTOMER = "5511944440000";
// Mesmas informações fictícias do seed da Empresa Demo.
const DEMO_KNOWLEDGE = [
  { title: "Horário de funcionamento", category: "Atendimento", content: "Segunda a sexta, das 8h às 18h. Sábado, das 8h às 12h. Fechado aos domingos e feriados." },
  { title: "Endereço", category: "Atendimento", content: "Rua Fictícia, 123 – Centro, São Paulo/SP. Há estacionamento conveniado na mesma rua." },
  { title: "Clareamento dental", category: "Preços", content: "Clareamento a laser: R$ 800,00 à vista ou em até 4x sem juros no cartão. Inclui avaliação." },
  { title: "Limpeza (profilaxia)", category: "Preços", content: "Limpeza completa: R$ 180,00. Duração aproximada de 40 minutos." },
  { title: "Convênios", category: "Políticas", content: "Atendemos os convênios Odonto Exemplo e Sorriso Fictício. Outros convênios: consultar a recepção." },
];

/** Sobe o simulador de verdade (scripts/ai-mock-anthropic.mjs) numa porta livre. */
async function startSimulator(): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, "../scripts/ai-mock-anthropic.mjs")], {
    env: { ...process.env, AI_SIM_ANTHROPIC_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise<string>((done, fail) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) done(`http://127.0.0.1:${match[1] ?? ""}`);
    });
    child.on("exit", (code) => {
      fail(new Error(`simulador encerrou (código ${String(code)})`));
    });
  });
  return { process: child, url };
}

/**
 * Regressão: "Vocês atendem aos sábados?" era respondida com a entrada de Convênios, porque o simulador casava
 * "atendem" dentro de "Atendemos" e não reconhecia "sábados" como "Sábado". Exercita o fluxo inteiro com o prompt
 * de produção e o simulador usado no teste manual.
 */
describe("IA: simulador local da Anthropic com a base da Empresa Demo", () => {
  let graph: MockGraphApi;
  let simulator: ChildProcess;
  let restore: (() => void)[] = [];
  let ctx: TestContext;
  let whatsapp: WhatsAppWorker;
  let ai: AiWorker;
  let company: Company;
  let owner: string;

  const customerSays = async (text: string) => {
    await postWebhook(ctx, inboundPayload({ phoneNumberId: PHONE, from: CUSTOMER, wamid: nextWamid("wamid.IN"), text }));
    await whatsapp.drain();
    await ai.drain();
  };
  const lastReply = () => (graph.messageRequests().at(-1)?.body as { text: { body: string } } | undefined)?.text.body;

  beforeAll(async () => {
    graph = new MockGraphApi();
    await graph.start();
    const started = await startSimulator();
    simulator = started.process;
    restore = [enableWhatsAppEnv(graph.url), enableAiEnv(started.url)];
    ctx = await createTestApp();
    whatsapp = ctx.app.get(WhatsAppWorker);
    ai = ctx.app.get(AiWorker);
  });

  beforeEach(async () => {
    await whatsapp.drain();
    await ai.drain();
    await resetDatabase(ctx.prisma);
    graph.reset();
    company = await createCompany(ctx.prisma, { name: "Empresa Demo" });
    await createAccountRow(ctx.prisma, company.id, PHONE);
    await ctx.prisma.aiSettings.create({ data: { companyId: company.id, enabled: true, assistantName: "Sofia" } });
    await ctx.prisma.knowledgeEntry.createMany({
      data: DEMO_KNOWLEDGE.map((entry, position) => ({ ...entry, companyId: company.id, position })),
    });
    owner = await login(ctx.http, (await createMember(ctx.prisma, company.id, { role: "OWNER" })).email);
  });

  afterAll(async () => {
    await whatsapp.drain();
    await ai.drain();
    await ctx.app.close();
    await graph.stop();
    simulator.kill();
    for (const fn of restore.reverse()) fn();
  });

  it("depois de devolver a conversa do humano para a IA, 'Vocês atendem aos sábados?' usa o horário de funcionamento", async () => {
    await customerSays("Quero falar com um atendente");
    const conversation = await ctx.prisma.conversation.findFirstOrThrow({ where: { companyId: company.id } });
    expect(conversation.mode).toBe("HUMAN");
    const back = await ctx.http
      .post(`/api/companies/${company.id}/conversations/${conversation.id}/mode`)
      .set("Cookie", owner)
      .set("Origin", ORIGIN)
      .send({ action: "RETURN_TO_AI" });
    expect(back.status).toBe(200);

    await customerSays("Vocês atendem aos sábados?");
    expect(lastReply()).toContain("Sábado, das 8h às 12h");
    expect(lastReply()).not.toContain("Convênios");
  });

  it.each([
    ["Quais convênios vocês aceitam?", "Odonto Exemplo"],
    ["Qual o endereço?", "Rua Fictícia, 123"],
    ["Quanto custa a limpeza?", "R$ 180,00"],
    ["Vocês abrem no domingo?", "Fechado aos domingos"],
  ])("'%s' usa a entrada certa da base", async (question, expected) => {
    await customerSays(question);
    expect(lastReply()).toContain(expected);
  });
});
