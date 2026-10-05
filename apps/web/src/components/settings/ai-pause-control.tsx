"use client";

import type { AiStatusResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { apiMutate } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/** Pausa operacional da IA pela empresa (separada da habilitação feita pelo suporte). */
export function AiPauseControl({ companyId, status }: { companyId: string; status: AiStatusResponse }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { settings, permissions } = status;

  function run(body: object) {
    setError(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `/companies/${companyId}/ai/pause`, body);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {settings.paused ? (
          <>
            <span className="font-medium">A IA está pausada</span>
            {settings.pausedAt ? ` desde ${formatDateTime(settings.pausedAt)}` : ""}. Novas mensagens vão para a equipe.
          </>
        ) : settings.enabled ? (
          <span className="font-medium">A IA está ativa para a empresa.</span>
        ) : (
          <span className="text-muted-foreground">A IA está desligada pelo suporte da Vortrix AI.</span>
        )}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!permissions.editSettings ? null : settings.paused ? (
        <Button type="button" onClick={() => run({ action: "RESUME" })} disabled={pending || !settings.enabled}>
          {pending ? "Retomando…" : "Retomar a IA"}
        </Button>
      ) : (
        <ConfirmAction
          label="Pausar a IA"
          title="Pausar o atendimento automático?"
          effect={
            <ul className="list-disc space-y-1 pl-4">
              <li>A IA para de responder imediatamente; respostas em geração não são enviadas.</li>
              <li>Clientes que aguardavam a IA e as novas mensagens vão para a fila da equipe (expediente, disponibilidade e limites valem).</li>
              <li>Ao retomar, a IA atende só as próximas mensagens: nada é respondido retroativamente.</li>
            </ul>
          }
          confirmLabel="Pausar agora"
          destructive
          triggerVariant="destructive-outline"
          pending={pending}
          onConfirm={() => {
            run({ action: "PAUSE", confirm: true });
          }}
        />
      )}
      {settings.paused && !settings.enabled ? (
        <p className="text-xs text-muted-foreground">A IA foi desativada pelo suporte: a empresa não pode retomá-la por conta própria.</p>
      ) : null}
    </div>
  );
}
