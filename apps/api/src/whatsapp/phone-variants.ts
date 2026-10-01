/**
 * Variantes de um número brasileiro de celular com e sem o 9º dígito. O wa_id que a Meta envia
 * pode vir sem o 9 (contas antigas), enquanto o contato foi cadastrado com ele, ou vice-versa.
 * Para outros países, devolve só o próprio número.
 */
export function phoneVariants(digits: string): string[] {
  const withoutNine = /^55(\d{2})([6-9]\d{7})$/.exec(digits);
  if (withoutNine) return [digits, `55${withoutNine[1]}9${withoutNine[2]}`];
  const withNine = /^55(\d{2})9([6-9]\d{7})$/.exec(digits);
  if (withNine) return [digits, `55${withNine[1]}${withNine[2]}`];
  return [digits];
}
