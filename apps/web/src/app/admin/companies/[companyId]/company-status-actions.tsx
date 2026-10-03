"use client";

import type { CompanyStatus } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { apiMutate } from "@/lib/api-client";

/** Fase 7: suspender e reativar a empresa (somente SUPERADMIN; a API exige a confirmação também). */
export function CompanyStatusActions({ companyId, companyName, status }: { companyId: string; companyName: string; status: CompanyStatus }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const suspended = status === "PAUSED";

  function run(action: "suspend" | "reactivate") {
    setError(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `/admin/companies/${companyId}/${action}`, { confirm: true });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {suspended ? (
        <ConfirmAction
          label="Reativar empresa"
          title={`Reativar ${companyName}?`}
          effect={
            <ul className="list-disc space-y-1 pl-4">
              <li>Os usuários ativos voltam a acessar o painel; o WhatsApp volta a receber mensagens.</li>
              <li>A fila volta a ser distribuída e a IA volta a responder as próximas mensagens (conforme as configurações).</li>
              <li>Mensagens recebidas durante a suspensão foram descartadas e não são recuperadas; nada é respondido retroativamente.</li>
            </ul>
          }
          confirmLabel="Reativar"
          pending={pending}
          onConfirm={() => {
            run("reactivate");
          }}
        />
      ) : (
        <ConfirmAction
          label="Suspender empresa"
          title={`Suspender ${companyName}?`}
          effect={
            <ul className="list-disc space-y-1 pl-4">
              <li>Todos os usuários da empresa perdem o acesso imediatamente (sessões encerradas) e veem a tela de suspensão.</li>
              <li>A IA para, nenhuma mensagem é enviada e a distribuição é interrompida.</li>
              <li>Mensagens que chegarem pelo WhatsApp durante a suspensão serão descartadas e não poderão ser recuperadas.</li>
              <li>Nenhum dado é apagado: conversas, contatos, configurações e relatórios ficam preservados.</li>
            </ul>
          }
          confirmLabel="Suspender agora"
          destructive
          pending={pending}
          onConfirm={() => {
            run("suspend");
          }}
        />
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
