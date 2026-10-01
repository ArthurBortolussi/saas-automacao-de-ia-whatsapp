import { INBOX_FILTERS, type ConversationDetail, type ConversationSummary, type InboxFilter, type MessagePage, type Paginated } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { fetchPageData, fetchPageDataOrNull, requireMembership } from "@/lib/api-server";
import { ChatPanel } from "./chat-panel";
import { ContactPanel } from "./contact-panel";
import { ConversationList } from "./conversation-list";

export const metadata: Metadata = { title: "Inbox" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function InboxPage({ searchParams }: PageProps<"/dashboard/inbox">) {
  const { companyId } = await requireMembership();
  const params = await searchParams;
  const filterParam = firstParam(params["filter"]);
  const filter: InboxFilter = (INBOX_FILTERS as readonly string[]).includes(filterParam) ? (filterParam as InboxFilter) : "all";
  const selectedId = firstParam(params["c"]);
  const hasSelection = UUID.test(selectedId);

  const base = `/companies/${companyId}/conversations`;
  const [list, conversation, messages] = await Promise.all([
    fetchPageData<Paginated<ConversationSummary>>(`${base}?filter=${filter}&pageSize=50`),
    hasSelection ? fetchPageDataOrNull<ConversationDetail>(`${base}/${selectedId}`) : null,
    hasSelection ? fetchPageDataOrNull<MessagePage>(`${base}/${selectedId}/messages?limit=50`) : null,
  ]);

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-7.5rem)] overflow-hidden border-y bg-card md:-mx-10 md:-my-10 md:h-dvh md:border-y-0">
      <aside className={cn("w-full shrink-0 flex-col border-r md:flex md:w-80", selectedId ? "hidden" : "flex")}>
        <ConversationList conversations={list} filter={filter} selectedId={conversation?.id ?? null} />
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden md:flex")}>
        {conversation && messages ? (
          <ChatPanel key={conversation.id} companyId={companyId} conversation={conversation} messages={messages} filter={filter} />
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessagesSquare />
                </EmptyMedia>
                <EmptyTitle>{selectedId ? "Conversa não encontrada" : "Selecione uma conversa"}</EmptyTitle>
                <EmptyDescription>
                  {selectedId
                    ? "Ela pode ter sido removida ou não pertence à sua empresa."
                    : "Escolha uma conversa na lista para ver o histórico e responder."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </section>
      {conversation ? (
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l xl:block">
          <ContactPanel conversation={conversation} />
        </aside>
      ) : null}
    </div>
  );
}
