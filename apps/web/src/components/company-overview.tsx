import type { CompanyDetail } from "@arthur-ai/shared";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { DetailList } from "@/components/detail-list";
import { CompanyStatusBadge } from "@/components/status-badge";
import { formatCnpj, formatDate, formatLocation, formatPhone } from "@/lib/format";

/** Dados cadastrais da empresa; usado no admin e no dashboard da empresa. */
export function CompanyOverview({ company }: { company: CompanyDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">Empresa</CardTitle>
        </CardHeader>
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
      </Card>
      <div className="space-y-6">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Contato</CardTitle>
          </CardHeader>
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
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Localização</CardTitle>
          </CardHeader>
          <DetailList
            items={[
              { label: "Endereço", value: company.address },
              { label: "Cidade/Estado", value: company.city || company.state ? formatLocation(company.city, company.state) : null },
              { label: "Horário", value: company.businessHours },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
