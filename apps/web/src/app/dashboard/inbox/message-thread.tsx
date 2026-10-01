"use client";

import type { MessageItem, MessagePage } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { cn } from "@arthur-ai/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatTime } from "@/lib/format";

interface MessageThreadProps {
  companyId: string;
  conversationId: string;
  initial: MessagePage;
}

const SENDER_LABEL: Record<MessageItem["senderType"], string> = {
  CONTACT: "Cliente",
  AGENT: "Atendente",
  AI: "IA",
  SYSTEM: "Sistema",
};

export function MessageThread({ companyId, conversationId, initial }: MessageThreadProps) {
  const [messages, setMessages] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

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
      setMessages((current) => [...page.items, ...current]);
      setHasMore(page.hasMore);
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
          return (
            <li key={message.id}>
              {newDay ? (
                <p className="my-4 text-center text-xs text-muted-foreground">{formatDate(message.createdAt)}</p>
              ) : null}
              <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                    outbound
                      ? message.senderType === "AI"
                        ? "rounded-br-sm bg-brand text-white"
                        : "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border bg-card text-card-foreground",
                  )}
                >
                  <p className="break-words whitespace-pre-wrap">{message.body}</p>
                  <p className={cn("mt-1 text-[11px]", outbound ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {outbound ? `${message.sender?.name ?? SENDER_LABEL[message.senderType]} · ` : ""}
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={bottomRef} />
    </div>
  );
}
