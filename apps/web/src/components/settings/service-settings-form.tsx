"use client";

import { updateServiceSettingsSchema, type CompanySettingsResponse } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import type { FormEvent } from "react";
import { Field } from "@/components/field";
import { zodFieldErrors } from "@/lib/form-errors";
import { Feedback } from "./feedback";
import { ReadOnlyNote } from "./read-only-note";
import { useSettingsMutation } from "./use-settings-mutation";

/** Aba Atendimento: limite de espera na fila (alerta) e encerramento por inatividade da equipe. */
export function ServiceSettingsForm({ data }: { data: CompanySettingsResponse }) {
  const { errors, setErrors, feedback, pending, submit } = useSettingsMutation();
  const editable = data.permissions.editService;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = updateServiceSettingsSchema.safeParse({
      maxQueueWaitMinutes: Number(form.get("maxQueueWaitMinutes")),
      inactivityTimeoutMinutes: Number(form.get("inactivityTimeoutMinutes")),
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    submit("PATCH", `/companies/${data.company.id}/settings/service`, parsed.data, "Configurações do atendimento salvas.");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Feedback value={feedback} />
      <fieldset disabled={!editable} className="space-y-6">
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm font-medium">Tempo máximo de espera na fila</p>
          <p className="text-xs text-muted-foreground">
            É um limite de alerta, não de encerramento: a conversa continua na fila, na mesma posição, e a distribuição automática segue
            normalmente. Acima do limite, ela fica destacada na Inbox e entra na contagem do painel. O tempo é contado no relógio, desde a
            entrada atual na fila (inclusive fora do expediente da equipe).
          </p>
          <Field id="maxQueueWaitMinutes" label="Minutos" error={errors["maxQueueWaitMinutes"]} hint="De 1 minuto a 24 horas. Padrão: 30 minutos.">
            <Input id="maxQueueWaitMinutes" name="maxQueueWaitMinutes" type="number" min={1} max={1440} defaultValue={data.service.maxQueueWaitMinutes} className="w-40" />
          </Field>
        </div>
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm font-medium">Encerramento automático dos atendimentos da equipe</p>
          <p className="text-xs text-muted-foreground">
            Atendimentos atribuídos sem nenhuma mensagem (do cliente ou da equipe) por este tempo são finalizados e liberam a vaga do
            funcionário. Se o cliente voltar a escrever, a conversa é reaberta. O prazo dos atendimentos só com a IA fica na aba IA.
          </p>
          <Field id="inactivityTimeoutMinutes" label="Minutos sem atividade" error={errors["inactivityTimeoutMinutes"]} hint="Mínimo 5, máximo 30 dias.">
            <Input
              id="inactivityTimeoutMinutes"
              name="inactivityTimeoutMinutes"
              type="number"
              min={5}
              max={43200}
              defaultValue={data.service.inactivityTimeoutMinutes}
              className="w-40"
            />
          </Field>
        </div>
      </fieldset>
      {editable ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      ) : (
        <ReadOnlyNote />
      )}
    </form>
  );
}
