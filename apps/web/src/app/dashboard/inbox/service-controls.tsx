"use client";

import type { ConversationDetail, EligibleAssignee } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { ArrowRightLeft, CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { apiMutate } from "@/lib/api-client";

interface Props {
  companyId: string;
  conversation: ConversationDetail;
}

/** Fase 5: finalizar e transferir. Os botões só aparecem com permissão; o backend confere tudo de novo. */
export function ServiceControls({ companyId, conversation }: Props) {
  const router = useRouter();
  const [assignees, setAssignees] = useState<EligibleAssignee[] | null>(null);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `/companies/${companyId}/conversations/${conversation.id}`;

  if (!conversation.permissions.close && !conversation.permissions.transfer) return null;

  function close() {
    setMessage(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `${base}/close`);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      router.refresh();
    });
  }

  function openTransfer() {
    setMessage(null);
    startTransition(async () => {
      // Lista só quem pode receber agora; a transferência confere de novo no servidor.
      const response = await fetch(`/api${base}/assignees`, { credentials: "same-origin" }).catch(() => null);
      if (!response?.ok) {
        setMessage({ kind: "error", text: "Não foi possível carregar a equipe." });
        return;
      }
      const list = (await response.json()) as EligibleAssignee[];
      setAssignees(list);
      setTarget(list[0]?.userId ?? "");
      if (list.length === 0) setMessage({ kind: "info", text: "Ninguém da equipe está disponível com vaga agora." });
    });
  }

  function transfer() {
    if (!target) return;
    setMessage(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `${base}/transfer`, { toUserId: target });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setAssignees(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {conversation.permissions.transfer && assignees === null ? (
          <Button size="sm" variant="outline" onClick={openTransfer} disabled={pending}>
            <ArrowRightLeft /> {conversation.status === "ASSIGNED" ? "Transferir" : "Atribuir a alguém"}
          </Button>
        ) : null}
        {assignees && assignees.length > 0 ? (
          <>
            <NativeSelect
              size="sm"
              className="max-w-56"
              aria-label="Transferir para"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
            >
              {assignees.map((assignee) => (
                <NativeSelectOption key={assignee.userId} value={assignee.userId}>
                  {assignee.name} ({assignee.activeConversations}/{assignee.maxConcurrent})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button size="sm" onClick={transfer} disabled={pending || !target}>
              Transferir
            </Button>
          </>
        ) : null}
        {assignees ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAssignees(null);
              setMessage(null);
            }}
            disabled={pending}
          >
            Cancelar
          </Button>
        ) : null}
        {conversation.permissions.close ? (
          <ConfirmAction
            size="sm"
            triggerVariant="outline"
            label={
              <>
                <CircleCheck /> Finalizar atendimento
              </>
            }
            title="Finalizar este atendimento?"
            effect="O atendimento é encerrado agora. Se o cliente escrever de novo, a conversa é reaberta automaticamente."
            confirmLabel="Finalizar"
            pending={pending}
            onConfirm={close}
          />
        ) : null}
      </div>
      {message ? (
        <p role="status" className={message.kind === "error" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
