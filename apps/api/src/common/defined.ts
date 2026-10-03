/** Só os campos enviados (atualização parcial: `undefined` = não mexer, `null` = limpar). */
export function definedOnly<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter((entry: [string, unknown]) => entry[1] !== undefined)) as Partial<T>;
}
