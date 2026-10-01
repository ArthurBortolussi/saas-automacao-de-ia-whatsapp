import type { WhatsAppAdminResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { DetailList } from "@/components/detail-list";
import { fetchPageData } from "@/lib/api-server";
import { formatDateTime } from "@/lib/format";
import { WhatsAppAccountActions } from "./account-actions";
import { WhatsAppAccountForm } from "./account-form";
import { WhatsAppStatusBadge } from "./status-badge";

export default async function CompanyWhatsAppPage({ params }: PageProps<"/admin/companies/[companyId]/whatsapp">) {
  const { companyId } = await params;
  const { platform, account } = await fetchPageData<WhatsAppAdminResponse>(`/admin/companies/${encodeURIComponent(companyId)}/whatsapp`);

  return (
    <div className="space-y-6">
      {!platform.enabled ? (
        <Alert>
          <AlertTitle>Integração desabilitada neste servidor</AlertTitle>
          <AlertDescription>
            Faltam as variáveis: {platform.missing.join(", ")}. O restante do sistema funciona normalmente; veja o README para configurar.
          </AlertDescription>
        </Alert>
      ) : platform.simulated ? (
        <Alert>
          <AlertTitle>Graph API SIMULADA</AlertTitle>
          <AlertDescription>
            Este servidor aponta para uma Graph API local de teste, não para a Meta. Nenhuma mensagem chega a um WhatsApp real.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{account ? "Configuração do número" : "Conectar número de WhatsApp"}</CardTitle>
            <CardDescription>
              Dados da WhatsApp Business Platform (Cloud API) desta empresa, obtidos no Meta Business Manager.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WhatsAppAccountForm companyId={companyId} account={account} disabled={!platform.enabled} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
              <CardTitle className="text-base">Status da conexão</CardTitle>
            </CardHeader>
            {account ? (
              <>
                <DetailList
                  items={[
                    { label: "Status", value: <WhatsAppStatusBadge status={account.status} /> },
                    { label: "Número", value: account.displayPhoneNumber },
                    { label: "Nome verificado", value: account.verifiedName },
                    { label: "Token", value: account.hasAccessToken ? `Configurado em ${formatDateTime(account.tokenUpdatedAt)}` : null },
                    { label: "Último teste", value: account.lastCheckedAt ? formatDateTime(account.lastCheckedAt) : null },
                  ]}
                />
                {account.lastErrorMessage ? (
                  <div className="border-t px-5 py-3 text-sm">
                    <p className="font-medium text-destructive">Último erro</p>
                    <p className="text-muted-foreground">{account.lastErrorMessage}</p>
                    {account.lastErrorAt ? <p className="text-xs text-muted-foreground">{formatDateTime(account.lastErrorAt)}</p> : null}
                  </div>
                ) : null}
                <div className="border-t px-5 py-4">
                  <WhatsAppAccountActions companyId={companyId} status={account.status} disabled={!platform.enabled} />
                </div>
              </>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum número conectado a esta empresa.</p>
            )}
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
              <CardTitle className="text-base">Webhook (configuração única do app na Meta)</CardTitle>
            </CardHeader>
            <div className="space-y-2 px-5 py-4 text-sm">
              <p className="text-muted-foreground">URL de callback (precisa ser HTTPS público):</p>
              <code className="block rounded-md bg-muted px-2 py-1 text-xs break-all">https://SEU-DOMINIO{platform.webhookPath}</code>
              <p className="text-muted-foreground">
                Campo a assinar: <code className="text-xs">messages</code>. Graph API {platform.graphApiVersion}. O verify token e o App
                Secret ficam nas variáveis de ambiente do servidor, nunca aqui.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
