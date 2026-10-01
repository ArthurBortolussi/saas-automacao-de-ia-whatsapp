/**
 * Normaliza para dígitos com DDI (formato E.164 sem "+").
 * Sem "+"/"00", números com 10 ou 11 dígitos são tratados como brasileiros (recebem DDI 55).
 * Retorna null se o número não for plausível.
 */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  // "+" ou "00" indicam que o DDI já foi informado: nada é presumido.
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (international) return /^\d{10,15}$/.test(digits) ? digits : null;
  const withCountry = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^\d{12,15}$/.test(withCountry) ? withCountry : null;
}

export function formatPhoneNumber(digits: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  if (br) return `+55 (${br[1]}) ${br[2]}-${br[3]}`;
  return `+${digits}`;
}
