import type { CompanyDetail, WhatsAppCompanyStatus } from "@arthur-ai/shared";
import { Card, CardContent } from "@arthur-ai/ui/components/card";
import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanyOverview } from "@/components/company-overview";
import { PageHeader } from "@/components/page-header";
import { fetchPageData, requireUser } from "@/lib/api-server";
import { MEMBER_ROLE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

const WHATSAPP_COMPANY_LABEL: Record<NonNullable<WhatsAppCompanyStatus["status"]>, string> = {
  PENDING: "em configuração",
  ACTIVE: "conectado",
  ERROR: "com problema; contate o suporte",
  DISABLED: "desativado",
};

export default async function CompanyDashboardPage() {
  const me = await requireUser();
  if (!me.membership) redirect("/");
  // Os dados vêm da rota tenant-scoped: a API confere o vínculo (userId, companyId).
  const [company, whatsapp] = await Promise.all([
    fetchPageData<CompanyDetail>(`/companies/${me.membership.company.id}`),
    fetchPageData<WhatsAppCompanyStatus>(`/companies/${me.membership.company.id}/whatsapp`),
  ]);

  return (
    <>
      <PageHeader
        title={company.name}
        description={`Olá, ${me.user.name.split(" ")[0] ?? me.user.name}. Você acessa como ${MEMBER_ROLE_LABEL[me.membership.role].toLowerCase()}.`}
      />
      <Card className="mb-6 py-4">
        <CardContent className="flex items-center gap-3 px-5">
          <MessageCircle className={whatsapp.connected ? "size-5 text-success" : "size-5 text-muted-foreground"} />
          <div className="text-sm">
            <p className="font-medium">
              WhatsApp: {whatsapp.connected ? "conectado" : whatsapp.status === null ? "não configurado" : WHATSAPP_COMPANY_LABEL[whatsapp.status]}
            </p>
            <p className="text-muted-foreground">
              {whatsapp.displayPhoneNumber
                ? `${whatsapp.displayPhoneNumber}${whatsapp.verifiedName ? ` · ${whatsapp.verifiedName}` : ""}`
                : "A conexão do número é feita pela equipe Arthur AI."}
            </p>
          </div>
        </CardContent>
      </Card>
      <CompanyOverview company={company} />
    </>
  );
}
