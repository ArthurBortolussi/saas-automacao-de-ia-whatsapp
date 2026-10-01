// Utilitários das ferramentas de SIMULAÇÃO local do WhatsApp. Nunca falam com a Meta.
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "";
export const WEBHOOK_URL = process.env.WHATSAPP_SIM_WEBHOOK_URL ?? `http://localhost:${process.env.API_PORT ?? "4000"}/api/webhooks/whatsapp`;
export const DEFAULT_PHONE_NUMBER_ID = "990000000000101";

if (!APP_SECRET) {
  console.error("WHATSAPP_APP_SECRET não está no .env. Copie o bloco WHATSAPP_* do .env.example (valores fictícios de teste).");
  process.exit(1);
}

/** Envia um webhook assinado exatamente como a Meta faria. */
export async function postSignedWebhook(payload) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body: raw,
  });
  return response.status;
}

export function envelope(phoneNumberId, value) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "990000000000001",
        changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5511900000000", phone_number_id: phoneNumberId }, ...value } }],
      },
    ],
  };
}
