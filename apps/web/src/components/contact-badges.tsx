import type { AgentAvailability, ContactStatus, ConversationMode, ConversationStatus } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { AVAILABILITY_LABEL, CONTACT_STATUS_LABEL, CONVERSATION_MODE_LABEL, CONVERSATION_STATUS_LABEL } from "@/lib/format";

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
        "inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground",
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

const AVAILABILITY_TONE: Record<AgentAvailability, string> = {
  AVAILABLE: "bg-success",
  BUSY: "bg-warning",
  AWAY: "bg-muted-foreground",
};

export function AvailabilityBadge({ availability, className }: { availability: AgentAvailability; className?: string }) {
  return (
    <Dot tone={AVAILABILITY_TONE[availability]} className={className}>
      {AVAILABILITY_LABEL[availability]}
    </Dot>
  );
}

/** Estado operacional (fila/encerrada). "Em andamento" e "Atribuída" não precisam de selo na lista. */
export function ConversationStatusBadge({ status, className }: { status: ConversationStatus; className?: string }) {
  if (status === "OPEN" || status === "ASSIGNED") return null;
  return (
    <Dot tone={status === "QUEUED" ? "bg-warning" : "bg-muted-foreground"} className={cn("text-[11px]", className)}>
      {CONVERSATION_STATUS_LABEL[status]}
    </Dot>
  );
}
