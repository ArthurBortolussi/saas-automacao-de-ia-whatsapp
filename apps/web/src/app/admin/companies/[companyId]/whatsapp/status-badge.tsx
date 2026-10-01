import type { WhatsAppAccountStatus } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";

export const WHATSAPP_STATUS_LABEL: Record<WhatsAppAccountStatus, string> = {
  PENDING: "Aguardando teste",
  ACTIVE: "Conectado",
  ERROR: "Com erro",
  DISABLED: "Desativado",
};

const TONE: Record<WhatsAppAccountStatus, string> = {
  PENDING: "bg-warning",
  ACTIVE: "bg-success",
  ERROR: "bg-destructive",
  DISABLED: "bg-muted-foreground",
};

export function WhatsAppStatusBadge({ status }: { status: WhatsAppAccountStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE[status])} />
      {WHATSAPP_STATUS_LABEL[status]}
    </span>
  );
}
