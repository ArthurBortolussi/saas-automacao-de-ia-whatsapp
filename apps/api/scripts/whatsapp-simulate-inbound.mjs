// SIMULAÇÃO: envia à API local um webhook assinado de "mensagem recebida de um cliente".
// Uso: pnpm whatsapp:simulate --from 5511988887777 --name "Cliente Teste" --text "Olá!"
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { DEFAULT_PHONE_NUMBER_ID, envelope, postSignedWebhook, WEBHOOK_URL } from "./_sim-common.mjs";

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "5511988887777" },
    name: { type: "string", default: "Cliente Simulado" },
    text: { type: "string", default: "Olá! Esta é uma mensagem SIMULADA." },
    "phone-number-id": { type: "string", default: DEFAULT_PHONE_NUMBER_ID },
  },
});

const wamid = `wamid.SIMULADO.IN.${randomBytes(8).toString("hex")}`;
const payload = envelope(values["phone-number-id"], {
  contacts: [{ profile: { name: values.name }, wa_id: values.from }],
  messages: [{ from: values.from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: values.text } }],
});

const status = await postSignedWebhook(payload);
console.log(`[SIMULADO] webhook enviado para ${WEBHOOK_URL} → HTTP ${status}`);
console.log(`  de: +${values.from} (${values.name}) | phone_number_id: ${values["phone-number-id"]} | texto: ${values.text}`);
if (status !== 200) console.log("  Dica: a API está rodando? As variáveis WHATSAPP_* do .env são as mesmas da API?");
