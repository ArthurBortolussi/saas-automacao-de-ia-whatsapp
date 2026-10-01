import type { ConversationChannel } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { MessageCircle, StickyNote } from "lucide-react";

export function ChannelBadge({ channel, className }: { channel: ConversationChannel; className?: string }) {
  const whatsapp = channel === "WHATSAPP";
  const Icon = whatsapp ? MessageCircle : StickyNote;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground", className)}
      title={whatsapp ? "Conversa pelo WhatsApp" : "Conversa interna: nada é enviado ao cliente"}
    >
      <Icon className={cn("size-3", whatsapp && "text-success")} />
      {whatsapp ? "WhatsApp" : "Interna"}
    </span>
  );
}
