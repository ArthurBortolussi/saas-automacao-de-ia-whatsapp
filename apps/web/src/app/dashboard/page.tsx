import type { CompanyDetail } from "@arthur-ai/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanyOverview } from "@/components/company-overview";
import { PageHeader } from "@/components/page-header";
import { fetchPageData, requireUser } from "@/lib/api-server";
import { MEMBER_ROLE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function CompanyDashboardPage() {
  const me = await requireUser();
  if (!me.membership) redirect("/");
  // Os dados vêm da rota tenant-scoped: a API confere o vínculo (userId, companyId).
  const company = await fetchPageData<CompanyDetail>(`/companies/${me.membership.company.id}`);

  return (
    <>
      <PageHeader
        title={company.name}
        description={`Olá, ${me.user.name.split(" ")[0] ?? me.user.name}. Você acessa como ${MEMBER_ROLE_LABEL[me.membership.role].toLowerCase()}.`}
      />
      <CompanyOverview company={company} />
    </>
  );
}
