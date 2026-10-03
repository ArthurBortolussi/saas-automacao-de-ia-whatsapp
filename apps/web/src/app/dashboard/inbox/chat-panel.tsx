import { formatPhoneNumber, type ConversationDetail, type InboxFilter, type MessagePage } from "@arthur-ai/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ChannelBadge } from "@/components/channel-badge";
import { ConversationModeBadge, ConversationStatusBadge } from "@/components/contact-badges";
import { AI_HANDOFF_REASON_LABEL, CLOSE_REASON_LABEL, formatDateTime } from "@/lib/format";
import { Composer } from "./composer";
import { MarkRead } from "./mark-read";
import { MessageThread } from "./message-thread";
import { ModeControls } from "./mode-controls";
import { ServiceControls } from "./service-controls";

interface ChatPanelProps {
  companyId: string;
  conversation: ConversationDetail;
  messages: MessagePage;
  filter: InboxFilter;
}

export function ChatPanel({ companyId, conversation, messages, filter }: ChatPanelProps) {
  const backHref = filter === "all" ? "/dashboard/inbox" : `/dashboard/inbox?filter=${filter}`;

  return (
    <>
      <MarkRead companyId={companyId} conversationId={conversation.id} unreadCount={conversation.unreadCount} />
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={backHref} prefetch={false} className="text-muted-foreground hover:text-foreground md:hidden" aria-label="Voltar para a lista">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold">{conversation.contact.name}</h2>
              <ConversationModeBadge mode={conversation.mode} />
              <ChannelBadge channel={conversation.channel} />
              <ConversationStatusBadge status={conversation.status} className="text-xs" />
              {conversation.queueOverdue ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Espera excessiva</span>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {formatPhoneNumber(conversation.contact.phone)}
              {conversation.assignedUser ? ` · Responsável: ${conversation.assignedUser.name}` : ""}
              {conversation.status === "QUEUED" && conversation.queuePosition ? ` · Posição na fila: ${conversation.queuePosition}` : ""}
              {conversation.status === "OPEN" && conversation.mode !== "AI" ? " · Sem responsável" : ""}
              <Link href={`/dashboard/contacts/${conversation.contact.id}`} prefetch={false} className="ml-2 underline-offset-4 hover:underline xl:hidden">
                Ver contato
              </Link>
            </p>
          </div>
        </div>
        {conversation.status === "CLOSED" ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Atendimento {conversation.closeReason ? CLOSE_REASON_LABEL[conversation.closeReason] : "finalizado"}
            {conversation.closedAt ? ` em ${formatDateTime(conversation.closedAt)}` : ""}. Se o cliente escrever de novo, a conversa é
            reaberta automaticamente.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <ModeControls companyId={companyId} conversationId={conversation.id} mode={conversation.mode} />
            <ServiceControls companyId={companyId} conversation={conversation} />
          </div>
        )}
        {conversation.mode === "HUMAN" && conversation.aiHandoffReason && conversation.aiHandoffAt ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            A IA transferiu esta conversa para a equipe em {formatDateTime(conversation.aiHandoffAt)}: {AI_HANDOFF_REASON_LABEL[conversation.aiHandoffReason]}.
          </p>
        ) : null}
      </header>
      <MessageThread companyId={companyId} conversationId={conversation.id} latest={messages} />
      <Composer
        companyId={companyId}
        conversationId={conversation.id}
        canReply={conversation.humanMayReply && conversation.status !== "CLOSED"}
        closed={conversation.status === "CLOSED"}
        mode={conversation.mode}
        channel={conversation.channel}
        serviceWindowOpen={conversation.serviceWindowOpen}
      />
    </>
  );
}
