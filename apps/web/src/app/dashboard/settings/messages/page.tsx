import type { CompanySettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { AutoMessagesForm } from "@/components/settings/auto-messages-form";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações · Mensagens" };

export default async function MessagesSettingsPage() {
  const { companyId } = await requireMembership();
  const data = await fetchPageData<CompanySettingsResponse>(`/companies/${companyId}/settings`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mensagens automáticas</CardTitle>
        <CardDescription>Boas-vindas, espera na fila, fora do expediente e encerramento.</CardDescription>
      </CardHeader>
      <CardContent>
        <AutoMessagesForm data={data} />
      </CardContent>
    </Card>
  );
}
