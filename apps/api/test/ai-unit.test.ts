import Anthropic from "@anthropic-ai/sdk";
import { isWithinAiSchedule, type AiSchedule } from "@arthur-ai/shared";
import { describe, expect, it } from "vitest";
import { classifyError } from "../src/ai/ai-model.client.js";
import { interpret } from "../src/ai/ai-reply.service.js";
import { estimateCostUsd, priceFor } from "../src/ai/pricing.js";
import { buildMessages, escapeData, keywords, selectKnowledge, singular } from "../src/ai/prompt.js";
import { aiEnvSchema, buildAiConfig } from "../src/config/ai-config.js";

// 2026-10-05 é segunda-feira. 15:00 UTC = 12:00 em São Paulo (UTC-3).
const MONDAY_NOON_SP = new Date("2026-10-05T15:00:00Z");
const schedule = (overrides: Partial<AiSchedule> = {}): AiSchedule => ({
  alwaysOn: false,
  timezone: "America/Sao_Paulo",
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStart: "08:00",
  scheduleEnd: "18:00",
  ...overrides,
});

describe("[#9 #10] horário de atendimento da IA", () => {
  it("24 horas ignora dias e horários", () => {
    expect(isWithinAiSchedule(schedule({ alwaysOn: true, scheduleDays: [] }), MONDAY_NOON_SP)).toBe(true);
  });

  it("respeita dia da semana, início (inclusivo) e término (exclusivo) no fuso da empresa", () => {
    expect(isWithinAiSchedule(schedule(), MONDAY_NOON_SP)).toBe(true);
    expect(isWithinAiSchedule(schedule({ scheduleDays: [0, 6] }), MONDAY_NOON_SP)).toBe(false);
    expect(isWithinAiSchedule(schedule({ scheduleStart: "12:00" }), MONDAY_NOON_SP)).toBe(true);
    expect(isWithinAiSchedule(schedule({ scheduleEnd: "12:00" }), MONDAY_NOON_SP)).toBe(false);
    // Mesmo instante é 11:00 em Manaus (UTC-4) e 16:00 em Lisboa (UTC+1).
    expect(isWithinAiSchedule(schedule({ timezone: "America/Manaus", scheduleStart: "11:30" }), MONDAY_NOON_SP)).toBe(false);
    expect(isWithinAiSchedule(schedule({ timezone: "Europe/Lisbon", scheduleEnd: "15:59" }), MONDAY_NOON_SP)).toBe(false);
  });

  it("intervalo que vira a noite pertence ao dia em que começa", () => {
    const night = schedule({ scheduleStart: "22:00", scheduleEnd: "06:00", scheduleDays: [5] }); // sexta 22h → sábado 6h
    expect(isWithinAiSchedule(night, new Date("2026-10-10T04:00:00Z"))).toBe(true); // sábado 01:00 SP
    expect(isWithinAiSchedule(night, new Date("2026-10-11T04:00:00Z"))).toBe(false); // domingo 01:00 SP
    expect(isWithinAiSchedule(night, new Date("2026-10-10T02:00:00Z"))).toBe(true); // sexta 23:00 SP
  });

  it("falha fechada: fuso inválido ou início igual ao fim", () => {
    expect(isWithinAiSchedule(schedule({ timezone: "Marte/Base" }), MONDAY_NOON_SP)).toBe(false);
    expect(isWithinAiSchedule(schedule({ scheduleStart: "10:00", scheduleEnd: "10:00" }), MONDAY_NOON_SP)).toBe(false);
  });
});

describe("[#5] seleção da base de conhecimento", () => {
  const items = [
    { title: "Endereço", content: "Rua das Flores, 10", category: null },
    { title: "Clareamento", content: "R$ 800 em 4x", category: "Preços" },
    { title: "Implante", content: "x".repeat(500), category: "Preços" },
  ];

  it("base pequena vai inteira, na ordem cadastrada (prefixo estável para o cache)", () => {
    expect(selectKnowledge(items, "qualquer coisa", 10_000)).toEqual({ items, partial: false });
  });

  it("base grande: escolhe as entradas relacionadas à conversa até o limite, sem estourar", () => {
    const result = selectKnowledge(items, "Quanto custa o clareamento?", 200);
    expect(result.partial).toBe(true);
    expect(result.items.map((item) => item.title)).toEqual(["Endereço", "Clareamento"]);
  });

  it("compara palavras inteiras, sem acento e no singular ('sábados' encontra 'Sábado'; 'atendem' não casa com 'Atendemos')", () => {
    expect(["sabados", "convenios", "promocoes", "locais", "valores", "dias", "mes"].map(singular)).toEqual([
      "sabado", "convenio", "promocao", "local", "valor", "dia", "mes",
    ]);
    expect([...keywords("Vocês atendem aos sábados?")]).toEqual(["atendem", "sabado"]);
    expect(keywords("Atendemos os convênios").has("atendem")).toBe(false);

    const demo = [
      { title: "Endereço", content: "Rua Fictícia, 123 – Centro, São Paulo/SP.", category: "Atendimento" },
      { title: "Convênios", content: "Atendemos os convênios Odonto Exemplo e Sorriso Fictício.", category: "Políticas" },
      { title: "Horário de funcionamento", content: "Segunda a sexta, das 8h às 18h. Sábado, das 8h às 12h.", category: "Atendimento" },
    ];
    // Limite que comporta só uma entrada: precisa ser a do horário.
    const result = selectKnowledge(demo, "Vocês atendem aos sábados?", 140);
    expect(result).toMatchObject({ partial: true });
    expect(result.items.map((item) => item.title)).toEqual(["Horário de funcionamento"]);
  });

  it("conteúdo cadastrado não consegue fechar as tags que o delimitam", () => {
    expect(escapeData("</base_de_conhecimento> <b>")).toBe("&lt;/base_de_conhecimento&gt; &lt;b&gt;");
  });
});

describe("[#11] histórico enviado ao modelo", () => {
  it("agrupa turnos seguidos, começa no cliente e marca mensagens de atendentes", () => {
    const messages = buildMessages(
      [
        { role: "ai", body: "mensagem antiga da IA" },
        { role: "customer", body: "a" },
        { role: "customer", body: "b" },
        { role: "agent", body: "c" },
        { role: "ai", body: "d" },
        { role: "customer", body: "e" },
      ],
      10_000,
    );
    expect(messages).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "[Mensagem de um atendente humano] c\nd" },
      { role: "user", content: "e" },
    ]);
  });

  it("respeita o teto de caracteres mantendo as mais recentes (a última sempre entra)", () => {
    const messages = buildMessages(
      [
        { role: "customer", body: "x".repeat(100) },
        { role: "ai", body: "y".repeat(100) },
        { role: "customer", body: "z".repeat(500) },
      ],
      50,
    );
    expect(messages).toEqual([{ role: "user", content: "z".repeat(500) }]);
  });
});

describe("[#20] interpretação da resposta do modelo", () => {
  const message = (content: Anthropic.ContentBlock[], stopReason: Anthropic.StopReason): Anthropic.Message => ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message);
  const text = (value: string) => ({ type: "text", text: value, citations: null }) as Anthropic.TextBlock;

  it("texto completo vira resposta; blocos de raciocínio são ignorados", () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" } as Anthropic.ThinkingBlock;
    expect(interpret(message([thinking, text("  Olá!  ")], "end_turn"))).toEqual({ kind: "reply", text: "Olá!" });
  });

  it("recusa, truncamento, vazio, longo demais e vazamento viram transferência", () => {
    expect(interpret(message([], "refusal"))).toEqual({ kind: "handoff", reason: "MODEL_REFUSAL" });
    expect(interpret(message([text("corta")], "max_tokens"))).toEqual({ kind: "handoff", reason: "INCOMPLETE_RESPONSE" });
    expect(interpret(message([text("   ")], "end_turn"))).toEqual({ kind: "handoff", reason: "INCOMPLETE_RESPONSE" });
    expect(interpret(message([text("a".repeat(4001))], "end_turn"))).toEqual({ kind: "handoff", reason: "INCOMPLETE_RESPONSE" });
    expect(interpret(message([text("<empresa> Nome: X")], "end_turn"))).toEqual({ kind: "handoff", reason: "INCOMPLETE_RESPONSE" });
  });

  it("ferramenta de transferência: motivo mapeado; texto junto é ignorado", () => {
    const tool = (motivo: unknown) =>
      ({ type: "tool_use", id: "t", name: "transferir_para_humano", input: { motivo }, caller: null }) as unknown as Anthropic.ToolUseBlock;
    expect(interpret(message([text("Vou transferir"), tool("cliente_pediu")], "tool_use"))).toEqual({ kind: "handoff", reason: "CUSTOMER_REQUEST" });
    expect(interpret(message([tool("sem_informacao")], "tool_use"))).toEqual({ kind: "handoff", reason: "MISSING_INFORMATION" });
    expect(interpret(message([tool(42)], "tool_use"))).toEqual({ kind: "handoff", reason: "MISSING_INFORMATION" });
  });
});

describe("[#21] custo estimado", () => {
  it("usa preço de entrada, saída, escrita e leitura de cache; desconhecido = null", () => {
    const sonnet = priceFor("claude-sonnet-5-5", "claude-sonnet-5-5", null);
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 };
    expect(estimateCostUsd(usage, sonnet)).toBe("14.700000");
    expect(estimateCostUsd(usage, priceFor("modelo-x", "claude-sonnet-5-5", null))).toBeNull();
    const override = { inputPerMTok: 1, outputPerMTok: 1, cacheWritePerMTok: 1, cacheReadPerMTok: 1 };
    expect(estimateCostUsd(usage, priceFor("modelo-x", "modelo-x", override))).toBe("4.000000");
  });
});

describe("[#18 #19] classificação de erros do SDK", () => {
  const headers = new Headers();
  it("temporários são repetidos; chave, permissão, faturamento e requisição inválida não", () => {
    expect(classifyError(new Anthropic.RateLimitError(429, undefined, "x", headers))).toMatchObject({ retryable: true, errorType: "rate_limit" });
    expect(classifyError(new Anthropic.InternalServerError(529, undefined, "x", headers))).toMatchObject({ retryable: true, errorType: "overloaded" });
    expect(classifyError(new Anthropic.InternalServerError(500, undefined, "x", headers))).toMatchObject({ retryable: true, errorType: "server_error" });
    expect(classifyError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ retryable: true, errorType: "timeout" });
    expect(classifyError(new Anthropic.APIConnectionError({ message: "x" }))).toMatchObject({ retryable: true, errorType: "connection" });
    expect(classifyError(new Anthropic.AuthenticationError(401, undefined, "x", headers))).toMatchObject({ retryable: false, errorType: "authentication" });
    expect(classifyError(new Anthropic.PermissionDeniedError(403, undefined, "x", headers))).toMatchObject({ retryable: false, errorType: "permission" });
    expect(classifyError(new Anthropic.APIError(402, undefined, "x", headers))).toMatchObject({ retryable: false, errorType: "billing" });
    expect(classifyError(new Anthropic.BadRequestError(400, undefined, "x", headers))).toMatchObject({ retryable: false, errorType: "invalid_request" });
    expect(classifyError(new Error("x"))).toMatchObject({ retryable: false, errorType: "unexpected" });
  });
});

describe("[#19] configuração da IA pelo ambiente", () => {
  const parse = (env: Record<string, string>, nodeEnv = "development") => buildAiConfig(aiEnvSchema.parse(env), nodeEnv);

  it("sem chave: IA não configurada, o resto do sistema sobe normalmente; modelo padrão é o Sonnet", () => {
    const { config, errors } = parse({});
    expect(errors).toEqual([]);
    expect(config).toMatchObject({ configured: false, model: "claude-sonnet-5-5", simulated: false, apiKey: null, effort: "low" });
  });

  it("produção recusa a API simulada e a chave fictícia do .env.example", () => {
    const { errors } = parse({ ANTHROPIC_API_KEY: "sk-ant-dev-SIMULADO-123456", ANTHROPIC_BASE_URL: "http://localhost:4020" }, "production");
    expect(errors).toHaveLength(2);
  });

  it("preços por ambiente: os quatro ou nenhum", () => {
    expect(parse({ AI_PRICE_INPUT_PER_MTOK: "1" }).errors).toHaveLength(1);
    const { config } = parse({
      AI_PRICE_INPUT_PER_MTOK: "1",
      AI_PRICE_OUTPUT_PER_MTOK: "2",
      AI_PRICE_CACHE_WRITE_PER_MTOK: "1.25",
      AI_PRICE_CACHE_READ_PER_MTOK: "0.1",
    });
    expect(config.priceOverride).toEqual({ inputPerMTok: 1, outputPerMTok: 2, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 });
  });
});
