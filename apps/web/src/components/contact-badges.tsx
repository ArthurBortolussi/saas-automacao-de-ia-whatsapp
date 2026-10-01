import type { ContactStatus, ConversationMode } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { CONTACT_STATUS_LABEL, CONVERSATION_MODE_LABEL } from "@/lib/format";

const STATUS_TONE: Record<ContactStatus, string> = {
  NEW: "bg-muted-foreground",
  LEAD: "bg-brand",
  QUALIFIED: "bg-warning",
  CUSTOMER: "bg-success",
  LOST: "bg-destructive",
};

const MODE_TONE: Record<ConversationMode, string> = {
  AI: "bg-brand",
  HUMAN: "bg-success",
  PAUSED: "bg-warning",
};

function Dot({ tone, children, className }: { tone: string; children: string; className?: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", tone)} />
      {children}
    </span>
  );
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Dot tone={STATUS_TONE[status]}>{CONTACT_STATUS_LABEL[status]}</Dot>;
}

export function ConversationModeBadge({ mode, className }: { mode: ConversationMode; className?: string }) {
  return (
    <Dot tone={MODE_TONE[mode]} className={className}>
      {CONVERSATION_MODE_LABEL[mode]}
    </Dot>
  );
}
