import type { CompanyDetail } from "@arthur-ai/shared";
import { cache } from "react";
import { fetchPageData } from "./api-server";

/** Memoizado por request: layout e página da empresa compartilham a mesma chamada. */
export const getAdminCompany = cache((companyId: string) =>
  fetchPageData<CompanyDetail>(`/admin/companies/${encodeURIComponent(companyId)}`),
);
