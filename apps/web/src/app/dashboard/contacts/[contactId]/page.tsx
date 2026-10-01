import { formatPhoneNumber, type ContactDetail, type ConversationSummary, type Paginated } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { CheckCircle2, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
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
      <Link href="/dashboard/contacts" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Contatos
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{contact.name}</h1>
            <ContactStatusBadge status={contact.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatPhoneNumber(contact.phone)} · cadastrado em {formatDate(contact.createdAt)}
          </p>
        </div>
        <StartConversationButton companyId={companyId} contactId={contact.id} />
      </div>
      {created ? (
        <Alert className="mb-6 max-w-3xl">
          <CheckCircle2 className="text-success" />
          <AlertDescription>Contato cadastrado.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do contato</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactForm companyId={companyId} contact={contact} />
          </CardContent>
        </Card>
        <Card className="gap-0 self-start py-0">
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-base">Conversas</CardTitle>
          </CardHeader>
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
                  <Link href={`/dashboard/inbox?c=${conversation.id}`} className="block space-y-1 px-5 py-3 hover:bg-muted/50">
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
        </Card>
      </div>
    </>
  );
}
