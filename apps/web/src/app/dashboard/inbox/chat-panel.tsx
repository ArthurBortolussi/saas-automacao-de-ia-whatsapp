import { formatPhoneNumber, type ConversationDetail, type InboxFilter, type MessagePage } from "@arthur-ai/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ChannelBadge } from "@/components/channel-badge";
import { ConversationModeBadge } from "@/components/contact-badges";
import { Composer } from "./composer";
import { MarkRead } from "./mark-read";
import { MessageThread } from "./message-thread";
import { ModeControls } from "./mode-controls";

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
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {formatPhoneNumber(conversation.contact.phone)}
              {conversation.assignedUser ? ` · Responsável: ${conversation.assignedUser.name}` : ""}
              <Link href={`/dashboard/contacts/${conversation.contact.id}`} prefetch={false} className="ml-2 underline-offset-4 hover:underline xl:hidden">
                Ver contato
              </Link>
            </p>
          </div>
        </div>
        <ModeControls companyId={companyId} conversationId={conversation.id} mode={conversation.mode} />
      </header>
      <MessageThread companyId={companyId} conversationId={conversation.id} latest={messages} />
      <Composer
        companyId={companyId}
        conversationId={conversation.id}
        canReply={conversation.humanMayReply}
        mode={conversation.mode}
        channel={conversation.channel}
        serviceWindowOpen={conversation.serviceWindowOpen}
      />
    </>
  );
}
