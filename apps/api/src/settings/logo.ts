/** FASE 7: logotipo da empresa. Formatos aceitos, conferidos pelos BYTES do arquivo (nunca pelo nome ou pelo cabeçalho). */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];

/** Tipo real pela assinatura do arquivo; SVG e qualquer outro formato são recusados (SVG pode conter script). */
export function detectLogoType(data: Buffer): LogoContentType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
