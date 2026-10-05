import type { CompanyAlertsResponse, CompanyDetail, ConversationSummary, InboxFilter, Paginated, WhatsAppCompanyStatus } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Button } from "@arthur-ai/ui/components/button";
import { ArrowRight, BarChart3, BookOpen, Bot, Clock, Contact, Inbox, MailOpen, MessageCircle, UserRound, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { StatCard } from "@/components/analytics/stat-card";
import { CompanyOverview } from "@/components/company-overview";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { CompanyAlerts } from "@/components/settings/company-alerts";
import { fetchPageData, requireUser } from "@/lib/api-server";
import { formatNumber, MEMBER_ROLE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

const WHATSAPP_COMPANY_LABEL: Record<NonNullable<WhatsAppCompanyStatus["status"]>, string> = {
  PENDING: "Em configuração",
  ACTIVE: "Conectado",
  ERROR: "Com problema",
  DISABLED: "Desativado",
};

const WHATSAPP_TONE: Record<NonNullable<WhatsAppCompanyStatus["status"]>, "success" | "warning" | "destructive" | "neutral"> = {
  PENDING: "warning",
  ACTIVE: "success",
  ERROR: "destructive",
  DISABLED: "neutral",
};

export default async function CompanyDashboardPage() {
  const me = await requireUser();
  if (!me.membership) redirect("/");
  const companyId = me.membership.company.id;
  // Os dados vêm das rotas tenant-scoped: a API confere o vínculo (userId, companyId).
  const manager = me.membership.role !== "AGENT";
  // Totais dos mesmos filtros da Inbox (nenhum indicador novo: só a contagem que a Inbox já mostra).
  const count = (filter: InboxFilter) =>
    fetchPageData<Paginated<ConversationSummary>>(`/companies/${companyId}/conversations?filter=${filter}&pageSize=1`).then((page) => page.total);
  const [company, whatsapp, alerts, queued, unread, withAi, mine] = await Promise.all([
    fetchPageData<CompanyDetail>(`/companies/${companyId}`),
    fetchPageData<WhatsAppCompanyStatus>(`/companies/${companyId}/whatsapp`),
    // Fase 7: alertas só para proprietário e administradores (a API recusa funcionários).
    manager ? fetchPageData<CompanyAlertsResponse>(`/companies/${companyId}/alerts`) : Promise.resolve(null),
    count("queued"),
    count("unread"),
    count("ai"),
    count("mine"),
  ]);
  const firstName = me.user.name.split(" ")[0] ?? me.user.name;

  const shortcuts: { href: string; label: string; description: string; icon: ReactNode }[] = [
    { href: "/dashboard/inbox", label: "Inbox", description: "Conversas e atendimentos", icon: <Inbox /> },
    { href: "/dashboard/contacts", label: "Contatos", description: "Clientes da empresa", icon: <Contact /> },
    { href: "/dashboard/knowledge-base", label: "Base de conhecimento", description: "O que a IA sabe responder", icon: <BookOpen /> },
    manager
      ? { href: "/dashboard/analytics", label: "Analytics", description: "Volume e tempos de resposta", icon: <BarChart3 /> }
      : { href: "/dashboard/team", label: "Equipe", description: "Quem está disponível", icon: <UsersRound /> },
  ];

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={`${company.name} · você acessa como ${MEMBER_ROLE_LABEL[me.membership.role].toLowerCase()}.`}
        actions={
          <Button asChild>
            <Link href="/dashboard/inbox" prefetch={false}>
              <Inbox /> Abrir Inbox
            </Link>
          </Button>
        }
      />
      {alerts ? <CompanyAlerts alerts={alerts} /> : null}

      <section aria-label="Situação agora" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aguardando na fila"
          value={formatNumber(queued)}
          hint={queued > 0 ? "Clientes esperando alguém da equipe" : "Ninguém esperando agora"}
          icon={<Clock />}
          attention={queued > 0}
          href="/dashboard/inbox?filter=queued"
        />
        <StatCard label="Não lidas" value={formatNumber(unread)} hint="Conversas com mensagens novas" icon={<MailOpen />} href="/dashboard/inbox?filter=unread" />
        <StatCard label="Com a IA" value={formatNumber(withAi)} hint="Conversas em que a IA está respondendo" icon={<Bot />} href="/dashboard/inbox?filter=ai" />
        <StatCard label="Meus atendimentos" value={formatNumber(mine)} hint="Atribuídos a você" icon={<UserRound />} href="/dashboard/inbox?filter=mine" />
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <SectionCard title="WhatsApp" description="Número usado para falar com os clientes" className="lg:col-span-1">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
              <MessageCircle className="size-5" />
            </span>
            <div className="min-w-0 space-y-1.5 text-sm">
              {whatsapp.status === null ? (
                <Badge variant="neutral">Não configurado</Badge>
              ) : (
                <Badge variant={whatsapp.connected ? "success" : WHATSAPP_TONE[whatsapp.status]}>
                  {whatsapp.connected ? "Conectado" : WHATSAPP_COMPANY_LABEL[whatsapp.status]}
                </Badge>
              )}
              <p className="truncate font-medium">{whatsapp.displayPhoneNumber ?? "Nenhum número conectado"}</p>
              <p className="text-muted-foreground">
                {whatsapp.verifiedName ??
                  (whatsapp.status === "ERROR" ? "Fale com o suporte para corrigir a conexão." : "A conexão do número é feita pela equipe Vortrix AI.")}
              </p>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Atalhos" className="lg:col-span-2" contentClassName="p-0">
          <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
            {shortcuts.map((item) => (
              <li key={item.href} className="sm:border-b sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0">
                <Link
                  href={item.href}
                  prefetch={false}
                  className="group flex items-center gap-3 px-5 py-4 transition-colors outline-none hover:bg-subtle focus-visible:bg-subtle"
                >
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong [&_svg]:size-4">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Dados da empresa</h2>
      <CompanyOverview company={company} />
    </>
  );
}
