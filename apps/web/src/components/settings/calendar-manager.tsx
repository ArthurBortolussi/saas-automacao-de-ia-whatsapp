"use client";

import {
  SCHEDULE_KIND_LABEL,
  SCHEDULE_KINDS,
  scheduleExceptionSchema,
  type CalendarResponse,
  type DayOverrideView,
  type ScheduleExceptionItem,
  type ScheduleKind,
  type ScheduleOverride,
} from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { zodFieldErrors } from "@/lib/form-errors";
import { formatPlainDate } from "@/lib/format";
import { Feedback } from "./feedback";
import { useSettingsMutation } from "./use-settings-mutation";

const MODE_LABEL: Record<ScheduleOverride, string> = { DEFAULT: "Segue a semana", CLOSED: "Fechado", CUSTOM: "Horário especial" };

interface Draft {
  id: string | null;
  date: string;
  label: string;
}

function describe(view: DayOverrideView): string {
  return view.mode === "CUSTOM" ? `${view.start ?? ""}–${view.end ?? ""}` : MODE_LABEL[view.mode];
}

function summary(item: ScheduleExceptionItem): string {
  return SCHEDULE_KINDS.map((kind) => `${SCHEDULE_KIND_LABEL[kind]}: ${describe(item[kind])}`).join(" · ");
}

/**
 * Calendário do ano: feriados nacionais (só referência, nunca fecham a empresa sozinhos) e datas especiais da
 * empresa, cada uma com regra própria para o horário geral, o da IA e o da equipe.
 */
export function CalendarManager({ companyId, calendar }: { companyId: string; calendar: CalendarResponse }) {
  const { errors, setErrors, feedback, pending, submit } = useSettingsMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const byDate = new Map(calendar.exceptions.map((item) => [item.date, item]));
  const rows = [
    ...calendar.holidays.map((holiday) => ({ date: holiday.date, holiday: holiday.name, exception: byDate.get(holiday.date) ?? null })),
    ...calendar.exceptions.filter((item) => !calendar.holidays.some((holiday) => holiday.date === item.date)).map((item) => ({ date: item.date, holiday: null, exception: item })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const editing = draft ? (draft.id ? calendar.exceptions.find((item) => item.id === draft.id) ?? null : null) : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    const override = (kind: ScheduleKind) => ({ mode: form.get(`${kind}.mode`), start: form.get(`${kind}.start`), end: form.get(`${kind}.end`) });
    const body = { date: form.get("date"), label: form.get("label"), business: override("business"), ai: override("ai"), team: override("team") };
    const parsed = scheduleExceptionSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    const path = draft.id ? `/companies/${companyId}/settings/exceptions/${draft.id}` : `/companies/${companyId}/settings/exceptions`;
    submit(draft.id ? "PUT" : "POST", path, body, "Data especial salva.", () => {
      setDraft(null);
    });
  }

  function remove(item: ScheduleExceptionItem) {
    submit("DELETE", `/companies/${companyId}/settings/exceptions/${item.id}`, undefined, "Data especial removida.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`?year=${calendar.year - 1}`} prefetch={false} className="rounded-md border px-2 py-1 hover:bg-muted">
            ← {calendar.year - 1}
          </Link>
          <span className="font-medium">{calendar.year}</span>
          <Link href={`?year=${calendar.year + 1}`} prefetch={false} className="rounded-md border px-2 py-1 hover:bg-muted">
            {calendar.year + 1} →
          </Link>
        </div>
        {calendar.canEdit && !draft ? (
          <Button
            size="sm"
            onClick={() => {
              setDraft({ id: null, date: `${calendar.year}-01-01`, label: "" });
            }}
          >
            Adicionar data especial
          </Button>
        ) : null}
      </div>
      <Feedback value={feedback} />

      {draft ? (
        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-md border p-4" key={`${draft.id ?? "new"}-${draft.date}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="date" label="Data" error={errors["date"]}>
              <Input id="date" name="date" type="date" defaultValue={draft.date} />
            </Field>
            <Field id="label" label="Descrição" error={errors["label"]} hint="Ex.: feriado municipal, inventário, véspera de Natal.">
              <Input id="label" name="label" defaultValue={draft.label} maxLength={120} />
            </Field>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {SCHEDULE_KINDS.map((kind) => {
              const current = editing?.[kind];
              return (
                <div key={kind} className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium">{SCHEDULE_KIND_LABEL[kind]}</p>
                  <NativeSelect name={`${kind}.mode`} defaultValue={current?.mode ?? "DEFAULT"} className="w-full" aria-label={`${SCHEDULE_KIND_LABEL[kind]}: regra`}>
                    {(Object.keys(MODE_LABEL) as ScheduleOverride[]).map((mode) => (
                      <NativeSelectOption key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <div className="grid grid-cols-2 gap-2">
                    <Field id={`${kind}.start`} label="Início (horário especial)" error={errors[`${kind}.start`]}>
                      <Input id={`${kind}.start`} name={`${kind}.start`} type="time" defaultValue={current?.start ?? ""} />
                    </Field>
                    <Field id={`${kind}.end`} label="Término" error={errors[`${kind}.end`]}>
                      <Input id={`${kind}.end`} name={`${kind}.end`} type="time" defaultValue={current?.end ?? ""} />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar data"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>O que é</TableHead>
            <TableHead>Funcionamento</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                Nenhuma data neste ano.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row) => (
            <TableRow key={row.date}>
              <TableCell className="whitespace-nowrap">{formatPlainDate(row.date)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  {row.holiday ? <Badge variant="info">Feriado nacional</Badge> : null}
                  <span>{row.exception?.label ?? row.holiday}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.exception ? summary(row.exception) : "Funcionamento normal (o feriado não fecha a empresa sozinho)"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {calendar.canEdit ? (
                  row.exception ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (row.exception) setDraft({ id: row.exception.id, date: row.exception.date, label: row.exception.label });
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          if (row.exception) remove(row.exception);
                        }}
                      >
                        Remover
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDraft({ id: null, date: row.date, label: row.holiday ?? "" });
                      }}
                    >
                      Configurar esta data
                    </Button>
                  )
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
