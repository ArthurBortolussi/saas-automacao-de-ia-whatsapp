import { CompanyOverview } from "@/components/company-overview";
import { getAdminCompany } from "@/lib/admin-data";

export default async function CompanyOverviewPage({ params }: PageProps<"/admin/companies/[companyId]">) {
  const { companyId } = await params;
  const company = await getAdminCompany(companyId);
  return <CompanyOverview company={company} />;
}
