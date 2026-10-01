"use client";

import { MESSAGE_MAX_LENGTH, sendMessageSchema, type ConversationMode } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Textarea } from "@arthur-ai/ui/components/textarea";
import { SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { apiMutate } from "@/lib/api-client";

const BLOCKED_HINT: Record<ConversationMode, string> = {
  AI: "A IA está responsável por esta conversa. Assuma o atendimento para responder.",
  PAUSED: "Atendimento pausado. Reative ou assuma o atendimento para responder.",
  HUMAN: "",
};

interface ComposerProps {
  companyId: string;
  conversationId: string;
  canReply: boolean;
  mode: ConversationMode;
}

export function Composer({ companyId, conversationId, canReply, mode }: ComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const parsed = sendMessageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Mensagem inválida.");
      return;
    }
    setError(null);
    // Limpa na hora (como em apps de chat); se o envio falhar, o texto volta para o campo.
    setBody("");
    startTransition(async () => {
      const result = await apiMutate("POST", `/companies/${companyId}/conversations/${conversationId}/messages`, parsed.data);
      if (!result.ok) {
        setBody(parsed.data.body);
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra linha.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  if (!canReply) {
    return <div className="border-t bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">{BLOCKED_HINT[mode]}</div>;
  }

  return (
    <form onSubmit={onSubmit} className="border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
          aria-label="Mensagem"
          rows={2}
          maxLength={MESSAGE_MAX_LENGTH}
          className="max-h-40 min-h-11 resize-none"
          disabled={pending}
        />
        <Button type="submit" size="icon" disabled={pending || body.trim() === ""} aria-label="Enviar">
          <SendHorizontal />
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {error ? <span className="text-destructive">{error}</span> : "Mensagem interna: nesta fase nada é enviado ao WhatsApp."}
      </p>
    </form>
  );
}
