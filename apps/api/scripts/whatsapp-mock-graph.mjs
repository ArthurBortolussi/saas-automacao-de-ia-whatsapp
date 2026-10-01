// SIMULAÇÃO: servidor local que imita a Graph API da Meta (envio de mensagens e consulta do número).
// Depois de "enviar", devolve os status sent → delivered → read por webhook assinado, como a Meta.
// Gatilhos no texto da mensagem: #falha (131026), #token (190), #limite (130429), #semstatus.
// Uso: pnpm whatsapp:mock-graph   (e WHATSAPP_GRAPH_API_BASE_URL=http://localhost:4010 no .env)
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { envelope, postSignedWebhook } from "./_sim-common.mjs";

const PORT = Number(process.env.WHATSAPP_SIM_GRAPH_PORT ?? 4010);

function reply(res, status, json) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

const metaError = (code, message) => ({ error: { message: `[SIMULADO] ${message}`, type: "OAuthException", code, fbtrace_id: "SIMULADO" } });

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    return null;
  }
}

function scheduleStatuses(phoneNumberId, wamid, to) {
  const steps = [
    ["sent", 500],
    ["delivered", 1500],
    ["read", 3000],
  ];
  for (const [status, delay] of steps) {
    setTimeout(async () => {
      const payload = envelope(phoneNumberId, {
        statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to }],
      });
      const code = await postSignedWebhook(payload).catch(() => "sem resposta");
      console.log(`  ← status "${status}" enviado à API (HTTP ${code})`);
    }, delay);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const auth = req.headers.authorization ? "Bearer ****" : "(sem token)";
  console.log(`[SIMULADO] ${req.method} ${url.pathname} ${auth}`);

  const sendMatch = /^\/v\d+\.\d+\/(\d+)\/messages$/.exec(url.pathname);
  if (req.method === "POST" && sendMatch) {
    const phoneNumberId = sendMatch[1];
    const body = await readJson(req);
    const text = body?.text?.body ?? "";
    if (text.includes("#token")) return reply(res, 401, metaError(190, "Token expirado"));
    if (text.includes("#limite")) return reply(res, 429, metaError(130429, "Limite de envio"));
    if (text.includes("#falha")) return reply(res, 400, metaError(131026, "Mensagem não entregável"));
    const wamid = `wamid.SIMULADO.OUT.${randomBytes(8).toString("hex")}`;
    console.log(`  → para +${body?.to}: "${text.slice(0, 60)}" (${wamid})`);
    reply(res, 200, { messaging_product: "whatsapp", contacts: [{ input: body?.to, wa_id: body?.to }], messages: [{ id: wamid }] });
    if (!text.includes("#semstatus")) scheduleStatuses(phoneNumberId, wamid, body?.to);
    return;
  }

  const numberMatch = /^\/v\d+\.\d+\/(\d+)$/.exec(url.pathname);
  if (req.method === "GET" && numberMatch) {
    return reply(res, 200, { id: numberMatch[1], display_phone_number: "+55 11 90000-0000", verified_name: "Empresa Demo (SIMULADO)", quality_rating: "GREEN" });
  }
  reply(res, 404, metaError(100, "Rota não simulada"));
}).listen(PORT, () => {
  console.log(`Graph API SIMULADA ouvindo em http://localhost:${PORT} (nada aqui fala com a Meta).`);
});
