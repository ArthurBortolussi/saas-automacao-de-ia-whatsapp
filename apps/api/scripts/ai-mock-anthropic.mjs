// SIMULAÇÃO: servidor local que imita POST /v1/messages da API da Anthropic. Não é o Claude: as respostas
// são montadas por regras simples a partir da base de conhecimento enviada no prompt. Serve para testar o
// fluxo completo (fila, agrupamento, envio, transferência, consumo) sem chave real e sem custo.
// Gatilhos na mensagem do cliente:
//   "atendente", "humano", "pessoa" ou #humano → pede transferência (cliente_pediu)
//   #seminfo → transferência por falta de informação     #recusa → recusa do modelo
//   #corta → resposta truncada (max_tokens)               #erro → 529 sobrecarregado (temporário)
//   #chave → 401 chave inválida                            #lento → responde depois de 8 s
// Uso: pnpm ai:mock-anthropic  (e ANTHROPIC_BASE_URL=http://localhost:4020 no .env)
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.AI_SIM_ANTHROPIC_PORT ?? 4020);
const seenPrefixes = new Set();
let sequence = 0;

function reply(res, status, json) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

const apiError = (type, message) => ({ type: "error", error: { type, message: `[SIMULADO] ${message}` } });
const tokens = (text) => Math.max(1, Math.ceil(text.length / 4));

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    return null;
  }
}

const normalize = (text) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const unescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Entradas da base que vieram no prompt (bloco da empresa). */
function knowledge(system) {
  const entries = [];
  for (const match of system.matchAll(/<entrada titulo="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/entrada>/g)) {
    entries.push({ title: unescape(match[1]), content: unescape(match[2]) });
  }
  return entries;
}

function answer(system, question) {
  const name = /Seu nome: (.+)/.exec(system)?.[1] ?? "Assistente";
  const words = normalize(question).split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const hit = knowledge(system).find((entry) => words.some((word) => normalize(entry.title + " " + entry.content).includes(word)));
  if (hit) return `[SIMULADO] ${hit.title}: ${hit.content}`;
  if (/^(oi|ola|bom dia|boa tarde|boa noite)\b/.test(normalize(question.trim()))) {
    return `[SIMULADO] Olá! Eu sou ${name}, assistente virtual. Como posso ajudar?`;
  }
  return null;
}

function message(content, stopReason, inputText, outputText) {
  sequence += 1;
  const prefix = createHash("sha256").update(inputText.cachedPrefix).digest("hex");
  const cached = seenPrefixes.has(prefix);
  seenPrefixes.add(prefix);
  const prefixTokens = tokens(inputText.cachedPrefix);
  return {
    id: `msg_SIMULADO_${sequence}`,
    type: "message",
    role: "assistant",
    model: inputText.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    usage: {
      input_tokens: tokens(inputText.messages) + tokens(inputText.system.slice(inputText.cachedPrefix.length)),
      output_tokens: tokens(outputText),
      cache_creation_input_tokens: cached ? 0 : prefixTokens,
      cache_read_input_tokens: cached ? prefixTokens : 0,
    },
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method !== "POST" || url.pathname !== "/v1/messages") return reply(res, 404, apiError("not_found_error", "Rota não simulada"));
  const body = await readJson(req);
  if (!req.headers["x-api-key"]) return reply(res, 401, apiError("authentication_error", "Sem chave"));
  if (!body?.messages?.length) return reply(res, 400, apiError("invalid_request_error", "Corpo inválido"));

  const system = (body.system ?? []).map((block) => block.text).join("\n");
  const last = body.messages.at(-1);
  const question = typeof last?.content === "string" ? last.content : "";
  // Como na API real: só o prefixo até o último bloco com cache_control é cacheável (o bloco de data/hora fica fora).
  const blocks = body.system ?? [];
  const lastCached = blocks.findLastIndex((block) => block.cache_control);
  const cachedPrefix = blocks.slice(0, lastCached + 1).map((block) => block.text).join("\n");
  const input = { system, cachedPrefix, messages: JSON.stringify(body.messages), model: body.model };
  const lower = normalize(question);
  console.log(`[SIMULADO] POST /v1/messages modelo=${body.model} turnos=${body.messages.length} (chave ****)`);

  if (lower.includes("#lento")) await new Promise((resolve) => setTimeout(resolve, 8000));
  if (lower.includes("#chave")) return reply(res, 401, apiError("authentication_error", "Chave inválida"));
  if (lower.includes("#erro")) return reply(res, 529, apiError("overloaded_error", "Sobrecarregado"));
  if (lower.includes("#recusa")) return reply(res, 200, message([], "refusal", input, ""));
  if (lower.includes("#corta")) return reply(res, 200, message([{ type: "text", text: "Resposta cortada no" }], "max_tokens", input, "x".repeat(400)));

  const handoff = (motivo) => {
    console.log(`  → transferir_para_humano (${motivo})`);
    return reply(res, 200, message([{ type: "tool_use", id: `toolu_SIMULADO_${sequence}`, name: "transferir_para_humano", input: { motivo } }], "tool_use", input, motivo));
  };
  if (lower.includes("#seminfo")) return handoff("sem_informacao");
  if (/#humano|atendente|humano|pessoa/.test(lower)) return handoff("cliente_pediu");

  const text = answer(system, question);
  if (!text) return handoff("sem_informacao");
  console.log(`  → resposta: "${text.slice(0, 60)}"`);
  return reply(res, 200, message([{ type: "text", text }], "end_turn", input, text));
}).listen(PORT, () => {
  console.log(`Anthropic SIMULADA em http://localhost:${PORT} (não é o Claude; respostas por regras simples).`);
});
