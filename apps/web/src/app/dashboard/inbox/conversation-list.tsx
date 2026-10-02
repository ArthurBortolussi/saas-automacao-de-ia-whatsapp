import { formatPhoneNumber, type ConversationSummary, type InboxFilter, type Paginated } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { ChannelBadge } from "@/components/channel-badge";
import { ConversationModeBadge, ConversationStatusBadge } from "@/components/contact-badges";
import { formatListTime } from "@/lib/format";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Minhas" },
  { value: "queued", label: "Na fila" },
  { value: "ai", label: "IA atendendo" },
  { value: "human", label: "Humano atendendo" },
  { value: "paused", label: "Pausadas" },
  { value: "unread", label: "Não lidas" },
  { value: "unassigned", label: "Sem responsável" },
  { value: "closed", label: "Encerradas" },
];

const EMPTY_MESSAGE: Record<InboxFilter, string> = {
  all: "Nenhuma conversa ainda.",
  ai: "Nenhuma conversa com a IA.",
  human: "Nenhuma conversa com atendimento humano.",
  paused: "Nenhuma conversa pausada.",
  unread: "Tudo lido por aqui.",
  mine: "Nenhum atendimento atribuído a você.",
  queued: "Ninguém aguardando na fila.",
  unassigned: "Nenhuma conversa humana sem responsável.",
  closed: "Nenhum atendimento encerrado.",
};

interface ConversationListProps {
  conversations: Paginated<ConversationSummary>;
  filter: InboxFilter;
  selectedId: string | null;
  /** Filtro por responsável (vindo da aba Equipe), mantido ao navegar. */
  assignee: string | null;
}

export function ConversationList({ conversations, filter, selectedId, assignee }: ConversationListProps) {
  const query = (params: Record<string, string>) =>
    `/dashboard/inbox?${new URLSearchParams({ ...params, ...(assignee ? { assignee } : {}) }).toString()}`;

  return (
    <>
      <div className="space-y-3 border-b px-4 pt-4 pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
        {assignee ? (
          <p className="text-xs text-muted-foreground">
            Mostrando os atendimentos de um funcionário.{" "}
            <Link href="/dashboard/inbox" prefetch={false} className="underline underline-offset-4">
              Ver todas
            </Link>
          </p>
        ) : null}
        <nav className="-mx-1 flex flex-wrap gap-1" aria-label="Filtros">
          {FILTERS.map((item) => (
            <Link
              key={item.value}
              href={query(item.value === "all" ? {} : { filter: item.value })}
              // Sem prefetch: com o polling, o Next re-buscaria cada filtro a cada atualização.
              prefetch={false}
              aria-current={filter === item.value ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                filter === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      {conversations.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <Inbox className="size-5" />
          {EMPTY_MESSAGE[filter]}
        </div>
      ) : (
        <ul className="flex-1 divide-y overflow-y-auto">
          {conversations.items.map((conversation) => {
            const selected = conversation.id === selectedId;
            const unread = conversation.unreadCount > 0;
            return (
              <li key={conversation.id}>
                <Link
                  href={query({ ...(filter === "all" ? {} : { filter }), c: conversation.id })}
                  prefetch={false}
                  aria-current={selected ? "true" : undefined}
                  className={cn("block space-y-1.5 px-4 py-3 transition-colors", selected ? "bg-muted" : "hover:bg-muted/50")}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{conversation.contact.name}</span>
                    <span className={cn("shrink-0 text-xs", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {conversation.lastMessageAt ? formatListTime(conversation.lastMessageAt) : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                      {conversation.lastMessagePreview ?? formatPhoneNumber(conversation.contact.phone)}
                    </p>
                    {unread ? (
                      <span
                        className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white"
                        aria-label={`${conversation.unreadCount} não lidas`}
                      >
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ConversationModeBadge mode={conversation.mode} className="text-[11px]" />
                    <ChannelBadge channel={conversation.channel} />
                    <ConversationStatusBadge status={conversation.status} />
                    {conversation.status === "ASSIGNED" && conversation.assignedUser ? (
                      <span className="truncate text-[11px] text-muted-foreground">{conversation.assignedUser.name}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {conversations.total > conversations.items.length ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Mostrando as {conversations.items.length} conversas mais recentes de {conversations.total}.
        </p>
      ) : null}
    </>
  );
}
