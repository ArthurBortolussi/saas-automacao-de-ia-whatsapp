/**
 * Classificação dos erros da Cloud API. Mensagens em português e SEM dados sensíveis:
 * o texto bruto da Meta nunca é exibido nem persistido (pode conter números e identificadores).
 */
export type WhatsAppErrorKind = "auth" | "window" | "rate_limit" | "temporary" | "recipient" | "permanent";

export class WhatsAppApiError extends Error {
  constructor(
    readonly kind: WhatsAppErrorKind,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "WhatsAppApiError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "temporary";
  }
}

const AUTH_CODES = new Set([190, 102, 10, 200, 3, 33]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131056]);
const TEMPORARY_CODES = new Set([1, 2, 131000, 131016]);
const RECIPIENT_CODES = new Set([131026, 131030, 133010, 131021]);

const MESSAGES: Record<WhatsAppErrorKind, string> = {
  auth: "A Meta recusou as credenciais do número (token inválido, expirado ou sem permissão).",
  window: "A janela de 24 horas do WhatsApp está fechada: só é possível enviar um modelo aprovado pela Meta.",
  rate_limit: "Limite de envio da Meta atingido. O sistema tentará novamente.",
  temporary: "A Meta está temporariamente indisponível. O sistema tentará novamente.",
  recipient: "O número do cliente não pode receber esta mensagem pelo WhatsApp.",
  permanent: "A Meta recusou a mensagem.",
};

export function classifyMetaError(code: number | undefined, httpStatus: number): WhatsAppApiError {
  let kind: WhatsAppErrorKind;
  if (code === 131047) kind = "window";
  else if (code !== undefined && AUTH_CODES.has(code)) kind = "auth";
  else if (code !== undefined && RATE_LIMIT_CODES.has(code)) kind = "rate_limit";
  else if (code !== undefined && TEMPORARY_CODES.has(code)) kind = "temporary";
  else if (code !== undefined && RECIPIENT_CODES.has(code)) kind = "recipient";
  else if (httpStatus === 401) kind = "auth";
  else if (httpStatus === 429) kind = "rate_limit";
  else if (httpStatus >= 500) kind = "temporary";
  else kind = "permanent";
  const label = code === undefined ? `HTTP ${httpStatus}` : String(code);
  return new WhatsAppApiError(kind, label, `${MESSAGES[kind]} (código ${label})`);
}

export function networkError(): WhatsAppApiError {
  return new WhatsAppApiError("temporary", "NETWORK", "Não foi possível falar com a Meta (rede ou tempo esgotado). O sistema tentará novamente.");
}
