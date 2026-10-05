"use client";

import type { MessageDeliveryStatus, MessageItem, MessagePage } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { cn } from "@arthur-ai/ui/lib/utils";
import { AlertCircle, Bot, Check, CheckCheck, Clock, Headset, Info, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatTime } from "@/lib/format";

interface MessageThreadProps {
  companyId: string;
  conversationId: string;
  /** Página mais recente, vinda do servidor (atualizada pelo polling). */
  latest: MessagePage;
}

/**
 * Origem da mensagem: cada uma tem posição, cor e rótulo com ícone próprios (a origem nunca depende só da cor).
 * Cliente à esquerda; IA, equipe e mensagens automáticas à direita (todas são enviadas ao cliente).
 */
const ORIGIN: Record<MessageItem["senderType"], { label: string; icon: typeof Bot; bubble: string; meta: string; read: string }> = {
  CONTACT: { label: "Cliente", icon: UserRound, bubble: "rounded-bl-md border bg-bubble-contact text-foreground", meta: "text-muted-foreground", read: "text-brand-strong" },
  AI: { label: "IA", icon: Bot, bubble: "rounded-br-md border border-brand/15 bg-bubble-ai text-foreground", meta: "text-brand-strong/80", read: "text-brand-strong" },
  AGENT: { label: "Equipe", icon: Headset, bubble: "rounded-br-md bg-bubble-agent text-white", meta: "text-white/70", read: "text-sidebar-success" },
  SYSTEM: { label: "Mensagem automática", icon: Info, bubble: "rounded-br-md border border-warning/20 bg-bubble-system text-foreground", meta: "text-warning", read: "text-brand-strong" },
};

const STATUS: Record<MessageDeliveryStatus, { label: string; icon: typeof Check }> = {
  PENDING: { label: "Enviando", icon: Clock },
  SENT: { label: "Enviada", icon: Check },
  DELIVERED: { label: "Entregue", icon: CheckCheck },
  READ: { label: "Lida", icon: CheckCheck },
  FAILED: { label: "Falhou", icon: AlertCircle },
};

function DeliveryStatus({ status, readClassName }: { status: MessageDeliveryStatus; readClassName: string }) {
  const { label, icon: Icon } = STATUS[status];
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", status === "READ" && readClassName, status === "FAILED" && "font-medium")}
      title={label}
      aria-label={label}
    >
      <Icon className="size-3.5" />
      {status === "FAILED" ? label : null}
    </span>
  );
}

export function MessageThread({ companyId, conversationId, latest }: MessageThreadProps) {
  // Só as páginas antigas ficam no estado; a mais recente vem sempre das props (com status atualizados).
  const [older, setOlder] = useState<MessageItem[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const latestIds = new Set(latest.items.map((message) => message.id));
  const messages = [...older.filter((message) => !latestIds.has(message.id)), ...latest.items];
  const hasMore = hasMoreOlder ?? latest.hasMore;
  const lastId = latest.items.at(-1)?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/companies/${companyId}/conversations/${conversationId}/messages?limit=50&before=${oldest.id}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error();
      const page = (await response.json()) as MessagePage;
      setOlder((current) => [...page.items, ...current]);
      setHasMoreOlder(page.hasMore);
    } catch {
      setError("Não foi possível carregar as mensagens anteriores.");
    } finally {
      setLoading(false);
    }
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-subtle p-6 text-sm text-muted-foreground">
        Nenhuma mensagem nesta conversa ainda.
      </div>
    );
  }

  return (
    <div className="scroll-thin flex-1 overflow-y-auto bg-subtle px-3 py-4 sm:px-6" aria-live="polite">
      {hasMore ? (
        <div className="mb-4 flex flex-col items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loading}>
            {loading ? "Carregando…" : "Carregar mensagens anteriores"}
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
      <ol className="mx-auto max-w-3xl space-y-2.5">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || formatDate(previous.createdAt) !== formatDate(message.createdAt);
          const outbound = message.direction === "OUTBOUND";
          const failed = message.deliveryStatus === "FAILED";
          const origin = ORIGIN[outbound ? message.senderType : "CONTACT"];
          const OriginIcon = origin.icon;
          // Agrupa mensagens seguidas da mesma origem: o rótulo aparece só na primeira.
          const sameAsPrevious = !newDay && previous?.direction === message.direction && previous.senderType === message.senderType && previous.sender?.id === message.sender?.id;
          const senderName = message.senderType === "AGENT" ? (message.sender?.name ?? origin.label) : origin.label;
          return (
            <li key={message.id}>
              {newDay ? (
                <div className="my-5 flex items-center gap-3 text-[11px] font-medium text-muted-foreground" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  {formatDate(message.createdAt)}
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <div className={cn("flex flex-col", outbound ? "items-end" : "items-start", sameAsPrevious ? "" : "pt-1")}>
                {outbound && !sameAsPrevious ? (
                  <p className="mb-1 inline-flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
                    <OriginIcon className="size-3" aria-hidden />
                    {senderName}
                  </p>
                ) : null}
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-card sm:max-w-[75%]",
                    origin.bubble,
                    failed && "ring-2 ring-destructive/50",
                  )}
                >
                  {outbound ? null : <span className="sr-only">Cliente: </span>}
                  <p className="break-words whitespace-pre-wrap">{message.body}</p>
                  <p className={cn("mt-1 flex items-center justify-end gap-1.5 text-[11px] tabular-nums", origin.meta)}>
                    <span>{formatTime(message.createdAt)}</span>
                    {message.deliveryStatus ? <DeliveryStatus status={message.deliveryStatus} readClassName={origin.read} /> : null}
                  </p>
                </div>
                {message.errorMessage && (failed || message.deliveryStatus === "PENDING") ? (
                  <p className={cn("mt-1 max-w-[85%] text-right text-[11px] sm:max-w-[75%]", failed ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {failed ? "Não enviada: " : ""}
                    {message.errorMessage}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={bottomRef} />
    </div>
  );
}
