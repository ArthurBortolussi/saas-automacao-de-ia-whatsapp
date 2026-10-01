"use client";

import type { WhatsAppAccountAction, WhatsAppAccountStatus } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
    if (action === "DISABLE" && !window.confirm("Desativar? Mensagens deixam de ser recebidas e enviadas por este número.")) return;
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
            <Button size="sm" variant="outline" onClick={() => run("DISABLE")} disabled={pending || disabled}>
              Desativar
            </Button>
          </>
        )}
      </div>
      {feedback ? (
        <p role="status" className={feedback.kind === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
