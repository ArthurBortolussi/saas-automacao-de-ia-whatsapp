import type { Company } from "@arthur-ai/database";
import type { CompanyDetail, CompanySummary } from "@arthur-ai/shared";

export function toCompanySummary(company: Company): CompanySummary {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    industry: company.industry,
    status: company.status,
    city: company.city,
    state: company.state,
    createdAt: company.createdAt.toISOString(),
  };
}

/** Versão do logotipo para o cache do navegador (muda a cada upload). */
export function logoVersion(updatedAt: Date | null | undefined): string | null {
  return updatedAt ? String(updatedAt.getTime()) : null;
}

export function toCompanyDetail(company: Company, logoUpdatedAt: Date | null = null): CompanyDetail {
  return {
    ...toCompanySummary(company),
    legalName: company.legalName,
    cnpj: company.cnpj,
    phone: company.phone,
    email: company.email,
    website: company.website,
    address: company.address,
    businessHours: company.businessHours,
    updatedAt: company.updatedAt.toISOString(),
    timezone: company.timezone,
    suspendedAt: company.suspendedAt?.toISOString() ?? null,
    logoVersion: logoVersion(logoUpdatedAt),
  };
}
