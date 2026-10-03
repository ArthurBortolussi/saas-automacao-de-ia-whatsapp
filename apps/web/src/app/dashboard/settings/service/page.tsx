import type { CompanySettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { ServiceSettingsForm } from "@/components/settings/service-settings-form";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações · Atendimento" };

export default async function ServiceSettingsPage() {
  const { companyId } = await requireMembership();
  const data = await fetchPageData<CompanySettingsResponse>(`/companies/${companyId}/settings`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Atendimento e fila</CardTitle>
        <CardDescription>
          A distribuição continua automática e equilibrada (menos atendimentos primeiro). O expediente da equipe fica na aba Horários.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ServiceSettingsForm data={data} />
      </CardContent>
    </Card>
  );
}
