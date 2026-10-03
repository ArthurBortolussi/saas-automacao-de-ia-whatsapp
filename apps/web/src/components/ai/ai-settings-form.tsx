"use client";

import {
  AI_TONES,
  DEFAULT_CONVERSATION_MODES,
  DEFAULT_HANDOFF_MESSAGE,
  updateAdminAiSettingsSchema,
  updateCompanyAiSettingsSchema,
  type AiStatusResponse,
} from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Textarea } from "@arthur-ai/ui/components/textarea";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { AI_TONE_LABEL, WEEKDAY_SHORT } from "@/lib/format";

// Sugestões (qualquer fuso IANA válido é aceito).
const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"];

interface Props {
  companyId: string;
  status: AiStatusResponse;
  /** admin: rota do SUPERADMIN (inclui ligar/desligar e modo padrão). company: rota da empresa. */
  scope: "admin" | "company";
}

export function AiSettingsForm({ companyId, status, scope }: Props) {
  const router = useRouter();
  const { settings, permissions } = status;
  const readOnly = scope === "admin" ? !permissions.editAdminSettings : !permissions.editSettings;
  const [alwaysOn, setAlwaysOn] = useState(settings.alwaysOn);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const base = {
      assistantName: form.get("assistantName"),
      tone: form.get("tone"),
      instructions: form.get("instructions"),
      handoffMessage: form.get("handoffMessage"),
      inactivityTimeoutMinutes: Number(form.get("inactivityTimeoutMinutes")),
    };
    // Fase 7: na empresa, o horário da IA fica na aba Horários e o fuso na aba Empresa. O Superadmin edita tudo aqui.
    const limit = String(form.get("monthlyLimitUsd") ?? "").trim().replace(",", ".");
    const adminOnly = {
      alwaysOn: form.get("alwaysOn") === "on",
      timezone: form.get("timezone"),
      // Em 24 horas, dias e horários ficam como estavam (não precisam ser válidos agora).
      ...(form.get("alwaysOn") === "on"
        ? {}
        : { scheduleDays: form.getAll("scheduleDays").map(Number), scheduleStart: form.get("scheduleStart"), scheduleEnd: form.get("scheduleEnd") }),
      enabled: form.get("enabled") === "on",
      defaultConversationMode: form.get("defaultConversationMode"),
      // Só envia o limite quando mudou (cada alteração é auditada como mudança de limite).
      ...(limit === (status.budget?.limitUsd ?? "") ? {} : { monthlyLimitUsd: limit === "" ? null : Number(limit) }),
    };
    const common = scope === "admin" ? { ...base, ...adminOnly } : base;
    const parsed = scope === "admin" ? updateAdminAiSettingsSchema.safeParse(common) : updateCompanyAiSettingsSchema.safeParse(common);
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    // Envia o valor bruto (strings vazias limpam campos opcionais); o backend valida de novo.
    const body = common;
    const path = scope === "admin" ? `/admin/companies/${companyId}/ai/settings` : `/companies/${companyId}/ai/settings`;
    startTransition(async () => {
      const result = await apiMutate("PATCH", path, body);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setMessage({ kind: "success", text: "Configurações salvas." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "success" ? <CheckCircle2 className="text-success" /> : null}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      {scope === "admin" ? (
        <fieldset className="space-y-4 rounded-md border p-4" disabled={readOnly}>
          <legend className="px-1 text-sm font-medium">Operação (somente Superadmin)</legend>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="font-medium">IA ligada para esta empresa</span>
              <span className="block text-muted-foreground">Desligada, nenhuma resposta automática é gerada (nem cobrada).</span>
            </span>
          </label>
          <Field
            id="monthlyLimitUsd"
            label="Limite mensal de custo estimado (USD)"
            optional
            error={errors["monthlyLimitUsd"]}
            hint="Em branco = sem limite. Ao atingir 100%, a IA não inicia novas respostas e os atendimentos vão para a equipe."
          >
            <Input
              id="monthlyLimitUsd"
              name="monthlyLimitUsd"
              inputMode="decimal"
              defaultValue={status.budget?.limitUsd ?? ""}
              placeholder={status.budget?.platformDefaultUsd ? `padrão: ${status.budget.platformDefaultUsd}` : "sem limite"}
              className="w-48"
            />
          </Field>
          <Field id="defaultConversationMode" label="Modo inicial das novas conversas" error={errors["defaultConversationMode"]} hint="Vale só para conversas novas; as que já existem não mudam.">
            <NativeSelect id="defaultConversationMode" name="defaultConversationMode" defaultValue={settings.defaultConversationMode}>
              {DEFAULT_CONVERSATION_MODES.map((mode) => (
                <NativeSelectOption key={mode} value={mode}>
                  {mode === "AI" ? "Atendimento automático pela IA" : "Atendimento humano"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
      ) : null}

      <fieldset className="space-y-4" disabled={readOnly}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="assistantName" label="Nome do assistente" error={errors["assistantName"]}>
            <Input id="assistantName" name="assistantName" defaultValue={settings.assistantName} maxLength={60} />
          </Field>
          <Field id="tone" label="Tom de comunicação" error={errors["tone"]}>
            <NativeSelect id="tone" name="tone" defaultValue={settings.tone} className="w-full">
              {AI_TONES.map((tone) => (
                <NativeSelectOption key={tone} value={tone}>
                  {AI_TONE_LABEL[tone]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field
          id="instructions"
          label="Orientações da empresa"
          optional
          error={errors["instructions"]}
          hint="Como o assistente deve se comportar (ex.: sempre oferecer agendamento). Preços e políticas vão na Base de conhecimento."
        >
          <Textarea id="instructions" name="instructions" rows={4} maxLength={4000} defaultValue={settings.instructions ?? ""} />
        </Field>
        <Field id="handoffMessage" label="Mensagem de transferência para um atendente" optional error={errors["handoffMessage"]} hint={`Em branco, usa a padrão: "${DEFAULT_HANDOFF_MESSAGE}"`}>
          <Textarea id="handoffMessage" name="handoffMessage" rows={2} maxLength={1000} defaultValue={settings.handoffMessage ?? ""} />
        </Field>
      </fieldset>

      {scope === "admin" ? (
      <fieldset className="space-y-4 rounded-md border p-4" disabled={readOnly}>
        <legend className="px-1 text-sm font-medium">Horário em que a IA responde</legend>
        <p className="text-xs text-muted-foreground">
          Não é o horário de funcionamento da empresa: é quando a IA pode responder sozinha. Fora dele, as conversas ficam para a equipe.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="alwaysOn"
            checked={alwaysOn}
            onChange={(event) => {
              setAlwaysOn(event.target.checked);
            }}
            className="size-4 accent-primary"
          />
          <span className="font-medium">Atendimento 24 horas</span>
        </label>
        <div className={alwaysOn ? "pointer-events-none space-y-4 opacity-50" : "space-y-4"} aria-disabled={alwaysOn}>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Dias da semana</span>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_SHORT.map((label, day) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="scheduleDays" value={day} defaultChecked={settings.scheduleDays.includes(day)} className="size-4 accent-primary" />
                  {label}
                </label>
              ))}
            </div>
            {errors["scheduleDays"] ? <p className="text-xs text-destructive">{errors["scheduleDays"]}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="scheduleStart" label="Início" error={errors["scheduleStart"]}>
              <Input id="scheduleStart" name="scheduleStart" type="time" defaultValue={settings.scheduleStart} />
            </Field>
            <Field id="scheduleEnd" label="Término" error={errors["scheduleEnd"]} hint="Se for menor que o início, vira a noite.">
              <Input id="scheduleEnd" name="scheduleEnd" type="time" defaultValue={settings.scheduleEnd} />
            </Field>
            <Field id="timezone" label="Fuso horário da empresa" error={errors["timezone"]}>
              <Input id="timezone" name="timezone" list="ai-timezones" defaultValue={settings.timezone} maxLength={64} />
            </Field>
          </div>
          <datalist id="ai-timezones">
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>
      </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">
          O horário em que a IA responde fica na aba <span className="font-medium text-foreground">Horários</span>, junto do horário geral e do
          horário da equipe.
        </p>
      )}

      <fieldset className="space-y-3 rounded-md border p-4" disabled={readOnly}>
        <legend className="px-1 text-sm font-medium">Encerramento automático</legend>
        <p className="text-xs text-muted-foreground">
          Atendimentos que estão só com a IA são finalizados depois deste tempo sem mensagens. Se o cliente voltar a escrever, o atendimento
          reabre na mesma conversa. Não vale para atendimentos da equipe nem para conversas pausadas (o prazo da equipe fica na aba Equipe).
        </p>
        <Field id="inactivityTimeoutMinutes" label="Minutos sem atividade" error={errors["inactivityTimeoutMinutes"]} hint="Padrão: 240 minutos (4 horas). Mínimo 5, máximo 30 dias.">
          <Input
            id="inactivityTimeoutMinutes"
            name="inactivityTimeoutMinutes"
            type="number"
            min={5}
            max={43200}
            defaultValue={settings.inactivityTimeoutMinutes}
            className="w-40"
          />
        </Field>
      </fieldset>

      {readOnly ? (
        <p className="text-sm text-muted-foreground">Você pode consultar estas configurações. Somente o proprietário ou alguém com a permissão &quot;Configurações da IA&quot; pode alterá-las.</p>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar configurações"}
          </Button>
        </div>
      )}
    </form>
  );
}
