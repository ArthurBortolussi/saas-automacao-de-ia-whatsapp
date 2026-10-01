import type { Contact, Conversation, Message } from "@arthur-ai/database";
import { aiMayReply, humanMayReply, isServiceWindowOpen, type ConversationDetail, type ConversationSummary, type MessageItem } from "@arthur-ai/shared";
import { toContactDetail } from "../contacts/contact.mapper.js";

type UserRefRow = { id: string; name: string } | null;

export const userRefSelect = { select: { id: true, name: true } } as const;

export function toConversationSummary(
  conversation: Conversation & { contact: Pick<Contact, "id" | "name" | "phone" | "status">; assignedUser: UserRefRow },
): ConversationSummary {
  return {
    id: conversation.id,
    channel: conversation.channel,
    mode: conversation.mode,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conversation.lastMessagePreview,
    createdAt: conversation.createdAt.toISOString(),
    contact: conversation.contact,
    assignedUser: conversation.assignedUser,
  };
}

export function toConversationDetail(
  conversation: Conversation & { contact: Contact; assignedUser: UserRefRow },
): ConversationDetail {
  return {
    ...toConversationSummary(conversation),
    contact: toContactDetail(conversation.contact),
    aiMayReply: aiMayReply(conversation.mode),
    humanMayReply: humanMayReply(conversation.mode),
    lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
    serviceWindowOpen: conversation.channel === "WHATSAPP" && isServiceWindowOpen(conversation.lastInboundAt),
  };
}

export function toMessageItem(message: Message & { sender: UserRefRow }): MessageItem {
  return {
    id: message.id,
    direction: message.direction,
    senderType: message.senderType,
    sender: message.sender,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    externalType: message.externalType,
    deliveryStatus: message.deliveryStatus,
    errorMessage: message.errorMessage,
  };
}

/** Prévia de uma linha para a lista da inbox. */
export function messagePreview(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
