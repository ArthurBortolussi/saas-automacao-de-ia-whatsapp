"use client";

import type { MessageDeliveryStatus, MessageItem, MessagePage } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { cn } from "@arthur-ai/ui/lib/utils";
import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatTime } from "@/lib/format";

interface MessageThreadProps {
  companyId: string;
  conversationId: string;
  /** Página mais recente, vinda do servidor (atualizada pelo polling). */
  latest: MessagePage;
}

const SENDER_LABEL: Record<MessageItem["senderType"], string> = {
  CONTACT: "Cliente",
  AGENT: "Atendente",
  AI: "IA",
  SYSTEM: "Sistema",
};

const STATUS: Record<MessageDeliveryStatus, { label: string; icon: typeof Check; className?: string }> = {
  PENDING: { label: "Enviando", icon: Clock },
  SENT: { label: "Enviada", icon: Check },
  DELIVERED: { label: "Entregue", icon: CheckCheck },
  READ: { label: "Lida", icon: CheckCheck, className: "text-sky-300" },
  FAILED: { label: "Falhou", icon: AlertCircle, className: "text-red-300" },
};

function DeliveryStatus({ status }: { status: MessageDeliveryStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={label} aria-label={label}>
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
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Nenhuma mensagem nesta conversa ainda.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30 px-4 py-4" aria-live="polite">
      {hasMore ? (
        <div className="mb-4 flex flex-col items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loading}>
            {loading ? "Carregando…" : "Carregar mensagens anteriores"}
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
      <ol className="space-y-3">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || formatDate(previous.createdAt) !== formatDate(message.createdAt);
          const outbound = message.direction === "OUTBOUND";
          const failed = message.deliveryStatus === "FAILED";
          return (
            <li key={message.id}>
              {newDay ? <p className="my-4 text-center text-xs text-muted-foreground">{formatDate(message.createdAt)}</p> : null}
              <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                    outbound
                      ? message.senderType === "AI"
                        ? "rounded-br-sm bg-brand text-white"
                        : "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border bg-card text-card-foreground",
                    failed && "opacity-80 ring-2 ring-destructive/60",
                  )}
                >
                  <p className="break-words whitespace-pre-wrap">{message.body}</p>
                  <p className={cn("mt-1 flex items-center justify-end gap-1.5 text-[11px]", outbound ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    <span>
                      {outbound ? `${message.sender?.name ?? SENDER_LABEL[message.senderType]} · ` : ""}
                      {formatTime(message.createdAt)}
                    </span>
                    {message.deliveryStatus ? <DeliveryStatus status={message.deliveryStatus} /> : null}
                  </p>
                </div>
                {message.errorMessage && (failed || message.deliveryStatus === "PENDING") ? (
                  <p className={cn("mt-1 max-w-[78%] text-right text-[11px]", failed ? "text-destructive" : "text-muted-foreground")}>
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
