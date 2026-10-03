"use client";

import { AUTO_MESSAGE_KINDS, AUTO_MESSAGE_LABEL, updateAutoMessagesSchema, type AutoMessageKind, type CompanySettingsResponse } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Textarea } from "@arthur-ai/ui/components/textarea";
import type { FormEvent } from "react";
import { Field } from "@/components/field";
import { zodFieldErrors } from "@/lib/form-errors";
import { Feedback } from "./feedback";
import { ReadOnlyNote } from "./read-only-note";
import { useSettingsMutation } from "./use-settings-mutation";

const WHEN: Record<AutoMessageKind, string> = {
  welcome: "Somente no primeiro contato do cliente com a empresa (nunca em reaberturas).",
  queueNotice: "Uma vez a cada entrada na fila de atendimento humano.",
  afterHours: "Quando o cliente escreve fora do horário GERAL do negócio, uma vez por período fechado (mesmo que a IA responda).",
  closing: "Quando um funcionário finaliza o atendimento manualmente (nunca no encerramento automático).",
};

/** Aba Mensagens: ligar/desligar e personalizar. Texto em branco volta ao padrão; nada é reenviado a quem já recebeu. */
export function AutoMessagesForm({ data }: { data: CompanySettingsResponse }) {
  const { errors, setErrors, feedback, pending, submit } = useSettingsMutation();
  const editable = data.permissions.editMessages;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(
      AUTO_MESSAGE_KINDS.flatMap((kind) => [
        [`${kind}Enabled`, form.get(`${kind}Enabled`) === "on"],
        [`${kind}Message`, form.get(`${kind}Message`)],
      ]),
    );
    const parsed = updateAutoMessagesSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    // Envia o valor bruto (texto vazio = padrão); o backend valida de novo.
    submit("PATCH", `/companies/${data.company.id}/settings/messages`, body, "Mensagens salvas. As mudanças valem para os próximos envios.");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Feedback value={feedback} />
      <p className="text-sm text-muted-foreground">
        Mensagens operacionais enviadas pelo sistema (não pela IA), sempre respeitando a janela de 24 horas do WhatsApp. Elas aparecem na
        Inbox como &quot;Sistema&quot;.
      </p>
      <fieldset disabled={!editable} className="space-y-4">
        {AUTO_MESSAGE_KINDS.map((kind) => {
          const view = data.messages[kind];
          return (
            <div key={kind} className="space-y-3 rounded-md border p-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name={`${kind}Enabled`} defaultChecked={view.enabled} className="mt-0.5 size-4 accent-primary" />
                <span>
                  <span className="font-medium">{AUTO_MESSAGE_LABEL[kind]}</span>
                  <span className="block text-muted-foreground">{WHEN[kind]}</span>
                </span>
              </label>
              <Field id={`${kind}Message`} label="Texto" optional error={errors[`${kind}Message`]} hint={`Em branco, usa o padrão: "${view.defaultMessage}"`}>
                <Textarea id={`${kind}Message`} name={`${kind}Message`} rows={2} maxLength={1000} defaultValue={view.message ?? ""} />
              </Field>
            </div>
          );
        })}
      </fieldset>
      {editable ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar mensagens"}
          </Button>
        </div>
      ) : (
        <ReadOnlyNote />
      )}
    </form>
  );
}
