import type { CompanyDetail } from "@arthur-ai/shared";
import { DetailList } from "@/components/detail-list";
import { SectionCard } from "@/components/section-card";
import { CompanyStatusBadge } from "@/components/status-badge";
import { formatCnpj, formatDate, formatLocation, formatPhone } from "@/lib/format";

/** Dados cadastrais da empresa; usado no admin e no dashboard da empresa. */
export function CompanyOverview({ company }: { company: CompanyDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Empresa" contentClassName="p-0">
        <DetailList
          items={[
            { label: "Nome", value: company.name },
            { label: "Razão social", value: company.legalName },
            { label: "Segmento", value: company.industry },
            { label: "CNPJ", value: company.cnpj ? formatCnpj(company.cnpj) : null },
            { label: "Status", value: <CompanyStatusBadge status={company.status} /> },
            { label: "Criada em", value: formatDate(company.createdAt) },
          ]}
        />
      </SectionCard>
      <div className="space-y-6">
        <SectionCard title="Contato" contentClassName="p-0">
          <DetailList
            items={[
              { label: "Telefone", value: formatPhone(company.phone) },
              { label: "E-mail", value: company.email },
              {
                label: "Site",
                value: company.website ? (
                  <a href={company.website} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                    {company.website}
                  </a>
                ) : null,
              },
            ]}
          />
        </SectionCard>
        <SectionCard title="Localização" contentClassName="p-0">
          <DetailList
            items={[
              { label: "Endereço", value: company.address },
              { label: "Cidade/Estado", value: company.city || company.state ? formatLocation(company.city, company.state) : null },
              { label: "Horário", value: company.businessHours },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}
