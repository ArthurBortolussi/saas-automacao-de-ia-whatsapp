import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader
        back={{ href: "/admin/companies", label: "Empresas" }}
        title={company.name}
        badges={<CompanyStatusBadge status={company.status} />}
        description={`${company.industry} · criada em ${formatDate(company.createdAt)}${company.suspendedAt ? ` · suspensa em ${formatDate(company.suspendedAt)}` : ""}`}
        actions={<CompanyStatusActions companyId={company.id} companyName={company.name} status={company.status} />}
      />
      {/* Deixa explícito que tudo abaixo são dados DESTA empresa (e não da plataforma inteira). */}
      <p className="mb-4 flex items-center gap-2 rounded-lg border border-info/20 bg-info-soft px-3 py-2 text-xs text-foreground/80">
        <Building2 className="size-3.5 shrink-0 text-info" aria-hidden />
        <span>
          Você está vendo os dados da empresa <span className="font-medium text-foreground">{company.name}</span>.
        </span>
      </p>
      <CompanyTabs companyId={company.id} />
      <div>{children}</div>
    </>
  );
}
