import Link from "next/link";
import { CompanyStatusBadge } from "@/components/status-badge";
import { getAdminCompany } from "@/lib/admin-data";
import { formatDate } from "@/lib/format";
import { CompanyStatusActions } from "./company-status-actions";
import { CompanyTabs } from "./company-tabs";

export default async function CompanyLayout({ children, params }: LayoutProps<"/admin/companies/[companyId]">) {
  const { companyId } = await params;
  const company = await getAdminCompany(companyId);

  return (
    <>
      <Link href="/admin/companies" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Empresas
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <CompanyStatusBadge status={company.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {company.industry} · criada em {formatDate(company.createdAt)}
            {company.suspendedAt ? ` · suspensa em ${formatDate(company.suspendedAt)}` : ""}
          </p>
        </div>
        <CompanyStatusActions companyId={company.id} companyName={company.name} status={company.status} />
      </div>
      <CompanyTabs companyId={company.id} />
      <div className="pt-6">{children}</div>
    </>
  );
}
