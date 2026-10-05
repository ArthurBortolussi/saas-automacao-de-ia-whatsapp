import { formatPhoneNumber, type ContactDetail, type ConversationSummary, type Paginated } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { CheckCircle2, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { ContactStatusBadge, ConversationModeBadge } from "@/components/contact-badges";
import { ContactForm } from "@/components/contact-form";
import { StartConversationButton } from "@/components/start-conversation-button";
import { fetchPageData, requireMembership } from "@/lib/api-server";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Contato" };

export default async function ContactPage({ params, searchParams }: PageProps<"/dashboard/contacts/[contactId]">) {
  const { companyId } = await requireMembership();
  const { contactId } = await params;
  const created = (await searchParams)["created"] === "1";
  const id = encodeURIComponent(contactId);
  const [contact, conversations] = await Promise.all([
    fetchPageData<ContactDetail>(`/companies/${companyId}/contacts/${id}`),
    fetchPageData<Paginated<ConversationSummary>>(`/companies/${companyId}/conversations?contactId=${id}&pageSize=50`),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/dashboard/contacts", label: "Contatos" }}
        title={contact.name}
        badges={<ContactStatusBadge status={contact.status} />}
        description={`${formatPhoneNumber(contact.phone)} · cadastrado em ${formatDate(contact.createdAt)}`}
        actions={<StartConversationButton companyId={companyId} contactId={contact.id} />}
      />
      {created ? (
        <Alert variant="success" className="mb-6 max-w-3xl">
          <CheckCircle2 />
          <AlertDescription>Contato cadastrado.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <SectionCard title="Dados do contato" className="self-start">
          <ContactForm companyId={companyId} contact={contact} />
        </SectionCard>
        <SectionCard title="Conversas" description="Histórico de atendimentos com este contato" className="self-start" contentClassName="p-0">
          {conversations.items.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessagesSquare />
                </EmptyMedia>
                <EmptyTitle>Nenhuma conversa</EmptyTitle>
                <EmptyDescription>As conversas com este contato aparecem aqui.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y">
              {conversations.items.map((conversation) => (
                <li key={conversation.id}>
                  <Link href={`/dashboard/inbox?c=${conversation.id}`} prefetch={false} className="block space-y-1.5 px-5 py-3 transition-colors hover:bg-subtle">
                    <div className="flex items-center justify-between gap-2">
                      <ConversationModeBadge mode={conversation.mode} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {conversation.lastMessagePreview ?? "Sem mensagens ainda"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
