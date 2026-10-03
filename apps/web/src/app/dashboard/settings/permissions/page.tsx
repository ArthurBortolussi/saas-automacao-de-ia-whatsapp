import type { CompanySettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { PermissionsManager } from "@/components/settings/permissions-manager";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações · Permissões" };

export default async function PermissionsSettingsPage() {
  const { companyId } = await requireMembership();
  const data = await fetchPageData<CompanySettingsResponse>(`/companies/${companyId}/settings`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Permissões de configuração</CardTitle>
        <CardDescription>Quem pode editar cada grupo de configurações. Todos podem consultar as abas.</CardDescription>
      </CardHeader>
      <CardContent>
        <PermissionsManager data={data} />
      </CardContent>
    </Card>
  );
}
