import { formatPhoneNumber, type ConversationSummary, type InboxFilter, type Paginated } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { AlertTriangle, Inbox, UserRound } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { ChannelBadge } from "@/components/channel-badge";
import { ConversationModeBadge, ConversationStatusBadge } from "@/components/contact-badges";
import { formatListTime } from "@/lib/format";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Minhas" },
  { value: "queued", label: "Aguardando" },
  { value: "ai", label: "IA atendendo" },
  { value: "human", label: "Atendimento humano" },
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
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {conversations.total} {conversations.total === 1 ? "conversa" : "conversas"}
          </span>
        </div>
        {assignee ? (
          <p className="rounded-md bg-info-soft px-2.5 py-1.5 text-xs text-info">
            Mostrando os atendimentos de um funcionário.{" "}
            <Link href="/dashboard/inbox" prefetch={false} className="font-medium underline underline-offset-4">
              Ver todas
            </Link>
          </p>
        ) : null}
        <nav className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label="Filtros">
          {FILTERS.map((item) => (
            <Link
              key={item.value}
              href={query(item.value === "all" ? {} : { filter: item.value })}
              // Sem prefetch: com o polling, o Next re-buscaria cada filtro a cada atualização.
              prefetch={false}
              aria-current={filter === item.value ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                filter === item.value
                  ? "border-brand-strong bg-brand-strong font-medium text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      {conversations.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
            <Inbox className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">{EMPTY_MESSAGE[filter]}</p>
        </div>
      ) : (
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {conversations.items.map((conversation) => {
            const selected = conversation.id === selectedId;
            const unread = conversation.unreadCount > 0;
            return (
              <li key={conversation.id} className="border-b last:border-b-0">
                <Link
                  href={query({ ...(filter === "all" ? {} : { filter }), c: conversation.id })}
                  prefetch={false}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "relative flex gap-3 px-4 py-3 transition-colors outline-none focus-visible:bg-subtle",
                    selected ? "bg-brand-soft/60" : "hover:bg-subtle",
                  )}
                >
                  {/* Marcador lateral: seleção (índigo) ou espera acima do limite da empresa (vermelho, Fase 7). */}
                  {selected || conversation.queueOverdue ? (
                    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", conversation.queueOverdue ? "bg-destructive" : "bg-brand-strong")} />
                  ) : null}
                  <Avatar name={conversation.contact.name} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{conversation.contact.name}</span>
                      <span className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-semibold text-brand-strong" : "text-muted-foreground")}>
                        {conversation.lastMessageAt ? formatListTime(conversation.lastMessageAt) : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("truncate text-[13px]", unread ? "text-foreground" : "text-muted-foreground")}>
                        {conversation.lastMessagePreview ?? formatPhoneNumber(conversation.contact.phone)}
                      </p>
                      {unread ? (
                        <span
                          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-strong px-1.5 text-[11px] font-semibold text-primary-foreground"
                          aria-label={`${conversation.unreadCount} não lidas`}
                        >
                          {conversation.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <ConversationModeBadge mode={conversation.mode} className="text-[11px]" />
                      <ConversationStatusBadge status={conversation.status} />
                      {conversation.queueOverdue ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-destructive-soft px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                          <AlertTriangle className="size-3" aria-hidden /> Espera excessiva
                        </span>
                      ) : null}
                      {conversation.status === "ASSIGNED" && conversation.assignedUser ? (
                        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <UserRound className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{conversation.assignedUser.name}</span>
                        </span>
                      ) : null}
                      {conversation.channel !== "WHATSAPP" ? <ChannelBadge channel={conversation.channel} /> : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {conversations.total > conversations.items.length ? (
        <p className="border-t bg-subtle px-4 py-2 text-xs text-muted-foreground">
          Mostrando as {conversations.items.length} conversas mais recentes de {conversations.total}.
        </p>
      ) : null}
    </>
  );
}
