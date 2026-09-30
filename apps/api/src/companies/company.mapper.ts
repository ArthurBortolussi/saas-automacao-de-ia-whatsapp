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

export function toCompanyDetail(company: Company): CompanyDetail {
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
  };
}
