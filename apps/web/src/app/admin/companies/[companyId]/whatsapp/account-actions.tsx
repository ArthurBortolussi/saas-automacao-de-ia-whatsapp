"use client";

import type { WhatsAppAccountAction, WhatsAppAccountStatus } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { apiMutate } from "@/lib/api-client";

const DONE: Record<WhatsAppAccountAction, string> = {
  TEST: "Teste concluído.",
  DISABLE: "Integração desativada.",
  ENABLE: "Integração reativada. Teste a conexão.",
};

export function WhatsAppAccountActions({ companyId, status, disabled }: { companyId: string; status: WhatsAppAccountStatus; disabled: boolean }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: WhatsAppAccountAction) {
    setFeedback(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `/admin/companies/${companyId}/whatsapp/actions`, { action });
      setFeedback(result.ok ? { kind: "success", text: DONE[action] } : { kind: "error", text: result.error.message });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DISABLED" ? (
          <Button size="sm" onClick={() => run("ENABLE")} disabled={pending || disabled}>
            Reativar
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => run("TEST")} disabled={pending || disabled}>
              {pending ? "Aguarde…" : "Testar conexão"}
            </Button>
            <ConfirmAction
              size="sm"
              triggerVariant="destructive-outline"
              label="Desativar"
              title="Desativar a integração do WhatsApp?"
              effect="Mensagens deixam de ser recebidas e enviadas por este número até a integração ser reativada."
              confirmLabel="Desativar"
              destructive
              disabled={pending || disabled}
              pending={pending}
              onConfirm={() => run("DISABLE")}
            />
          </>
        )}
      </div>
      {feedback ? (
        <p role="status" className={feedback.kind === "error" ? "text-xs font-medium text-destructive" : "text-xs font-medium text-success"}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
