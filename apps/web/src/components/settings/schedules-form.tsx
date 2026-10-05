"use client";

import { SCHEDULE_KIND_LABEL, SCHEDULE_KINDS, updateSchedulesSchema, type CompanySettingsResponse, type ScheduleKind } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { zodFieldErrors } from "@/lib/form-errors";
import { WEEKDAY_SHORT } from "@/lib/format";
import { Feedback } from "./feedback";
import { ReadOnlyNote } from "./read-only-note";
import { useSettingsMutation } from "./use-settings-mutation";

const PURPOSE: Record<ScheduleKind, string> = {
  business: "Quando a empresa está oficialmente aberta. Usado no aviso de atendimento fora do expediente.",
  ai: "Quando a IA pode responder sozinha. Fora dele, ela não gera nem envia respostas.",
  team: "Quando o sistema distribui NOVOS atendimentos humanos. Ao terminar, quem já está atendendo continua; os novos esperam na fila.",
};

/** Aba Horários: três agendas independentes, no fuso da empresa. */
export function SchedulesForm({ data }: { data: CompanySettingsResponse }) {
  const { errors, setErrors, feedback, pending, submit } = useSettingsMutation();
  const editable = data.permissions.editSchedule;
  const [alwaysOn, setAlwaysOn] = useState<Record<ScheduleKind, boolean>>({
    business: data.schedules.business.alwaysOn,
    ai: data.schedules.ai.alwaysOn,
    team: data.schedules.team.alwaysOn,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const schedule = (kind: ScheduleKind) => ({
      alwaysOn: alwaysOn[kind],
      days: form.getAll(`${kind}.days`).map(Number),
      start: form.get(`${kind}.start`),
      end: form.get(`${kind}.end`),
    });
    const body = { business: schedule("business"), ai: schedule("ai"), team: schedule("team") };
    const parsed = updateSchedulesSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    submit("PATCH", `/companies/${data.company.id}/settings/schedules`, parsed.data, "Horários salvos. Valem a partir de agora.");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Feedback value={feedback} />
      <p className="text-sm text-muted-foreground">
        Fuso horário: <span className="font-medium text-foreground">{data.schedules.timezone}</span> (alterado na aba Empresa). Intervalos
        que viram a noite (ex.: 18:00–02:00) pertencem ao dia em que começam. Datas especiais, abaixo, prevalecem sobre a semana.
      </p>
      <fieldset disabled={!editable} className="grid gap-4 xl:grid-cols-3">
        {SCHEDULE_KINDS.map((kind) => {
          const schedule = data.schedules[kind];
          const open = data.openNow[kind];
          return (
            <div key={kind} className="space-y-4 rounded-md border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{SCHEDULE_KIND_LABEL[kind]}</p>
                <Badge variant={open ? "success" : "neutral"}>{open ? "Aberto agora" : "Fechado agora"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{PURPOSE[kind]}</p>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={alwaysOn[kind]}
                  onChange={(event) => {
                    setAlwaysOn((current) => ({ ...current, [kind]: event.target.checked }));
                  }}
                  className="size-4 accent-primary"
                />
                <span className="font-medium">24 horas, todos os dias</span>
              </label>
              <div className={alwaysOn[kind] ? "pointer-events-none space-y-4 opacity-50" : "space-y-4"} aria-disabled={alwaysOn[kind]}>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Dias da semana</span>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAY_SHORT.map((label, day) => (
                      <label key={label} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" name={`${kind}.days`} value={day} defaultChecked={schedule.days.includes(day)} className="size-4 accent-primary" />
                        {label}
                      </label>
                    ))}
                  </div>
                  {errors[`${kind}.days`] ? <p className="text-xs text-destructive">{errors[`${kind}.days`]}</p> : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field id={`${kind}.start`} label="Abertura" error={errors[`${kind}.start`]}>
                    <Input id={`${kind}.start`} name={`${kind}.start`} type="time" defaultValue={schedule.start} />
                  </Field>
                  <Field id={`${kind}.end`} label="Fechamento" error={errors[`${kind}.end`]}>
                    <Input id={`${kind}.end`} name={`${kind}.end`} type="time" defaultValue={schedule.end} />
                  </Field>
                </div>
              </div>
            </div>
          );
        })}
      </fieldset>
      {editable ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar horários"}
          </Button>
        </div>
      ) : (
        <ReadOnlyNote />
      )}
    </form>
  );
}
