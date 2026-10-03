import Image from "next/image";

/**
 * Logotipo servido pela API (rota da empresa, cookie first-party pelo rewrite /api). `version` muda a cada upload
 * para o navegador não mostrar o arquivo antigo do cache.
 */
export function CompanyLogo({ companyId, version, name, size = 40 }: { companyId: string; version: string | null; name: string; size?: number }) {
  if (!version) return null;
  return (
    <Image
      src={`/api/companies/${companyId}/logo?v=${version}`}
      alt={`Logotipo de ${name}`}
      width={size}
      height={size}
      unoptimized
      className="shrink-0 rounded-md border bg-background object-contain"
      style={{ width: size, height: size }}
    />
  );
}
