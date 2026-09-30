// Suporta o CNPJ numérico e o alfanumérico (IN RFB 2.229/2024, novas inscrições a partir de jul/2026):
// 12 posições alfanuméricas + 2 dígitos verificadores numéricos. O valor de cada caractere é
// o código ASCII menos 48, o que mantém o cálculo idêntico ao antigo para CNPJs só numéricos.
const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;

export function normalizeCnpj(value: string): string {
  return value.replace(/[.\-/\s]/g, "").toUpperCase();
}

function checkDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_PATTERN.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;
  const first = checkDigit(cnpj.slice(0, 12));
  const second = checkDigit(cnpj.slice(0, 12) + String(first));
  return cnpj.endsWith(`${first}${second}`);
}
