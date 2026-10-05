import type { CompanySettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { CompanyOverview } from "@/components/company-overview";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações · Empresa" };

export default async function CompanySettingsPage() {
  const { companyId } = await requireMembership();
  const data = await fetchPageData<CompanySettingsResponse>(`/companies/${companyId}/settings`);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identidade da empresa</CardTitle>
          <CardDescription>Nome comercial, logotipo e fuso horário. Somente o proprietário altera estes dados.</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyProfileForm data={data} />
        </CardContent>
      </Card>
      <div>
        <h2 className="mb-1 text-base font-semibold">Dados cadastrais</h2>
        <p className="mb-4 text-sm text-muted-foreground">Mantidos pela equipe Vortrix AI. Para corrigir algum dado, fale com o suporte.</p>
        <CompanyOverview company={data.company} />
      </div>
    </div>
  );
}
