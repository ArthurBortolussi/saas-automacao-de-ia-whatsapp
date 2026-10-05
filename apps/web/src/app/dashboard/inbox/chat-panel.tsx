import { formatPhoneNumber, type ConversationDetail, type InboxFilter, type MessagePage } from "@arthur-ai/shared";
import { AlertTriangle, ArrowLeft, Bot, CircleCheck } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
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
      <header className="border-b">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Link
            href={backHref}
            prefetch={false}
            className="-ml-1 grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Voltar para a lista"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <Avatar name={conversation.contact.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-[15px] font-semibold">{conversation.contact.name}</h2>
              <ConversationModeBadge mode={conversation.mode} />
              <ConversationStatusBadge status={conversation.status} className="text-xs" />
              {conversation.queueOverdue ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3" aria-hidden /> Espera excessiva
                </span>
              ) : null}
              {conversation.channel !== "WHATSAPP" ? <ChannelBadge channel={conversation.channel} /> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="tabular-nums">{formatPhoneNumber(conversation.contact.phone)}</span>
              {conversation.assignedUser ? ` · Responsável: ${conversation.assignedUser.name}` : ""}
              {conversation.status === "QUEUED" && conversation.queuePosition ? ` · Posição na fila: ${conversation.queuePosition}` : ""}
              {conversation.status === "OPEN" && conversation.mode !== "AI" ? " · Sem responsável" : ""}
            </p>
          </div>
          <Link
            href={`/dashboard/contacts/${conversation.contact.id}`}
            prefetch={false}
            className="hidden shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-strong hover:bg-brand-soft sm:inline-flex xl:hidden"
          >
            Ver contato
          </Link>
        </div>
        {conversation.status === "CLOSED" ? (
          <p className="flex items-start gap-2 border-t bg-subtle px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
            <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Atendimento {conversation.closeReason ? CLOSE_REASON_LABEL[conversation.closeReason] : "finalizado"}
              {conversation.closedAt ? ` em ${formatDateTime(conversation.closedAt)}` : ""}. Se o cliente escrever de novo, a conversa é reaberta
              automaticamente.
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-2 border-t bg-subtle px-4 py-2.5 sm:px-5">
            <ModeControls companyId={companyId} conversationId={conversation.id} mode={conversation.mode} />
            <ServiceControls companyId={companyId} conversation={conversation} />
          </div>
        )}
        {conversation.mode === "HUMAN" && conversation.aiHandoffReason && conversation.aiHandoffAt ? (
          <p className="flex items-start gap-2 border-t bg-info-soft px-4 py-2.5 text-xs text-foreground/80 sm:px-5">
            <Bot className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
            <span>
              A IA transferiu esta conversa para a equipe em {formatDateTime(conversation.aiHandoffAt)}: {AI_HANDOFF_REASON_LABEL[conversation.aiHandoffReason]}.
            </span>
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
