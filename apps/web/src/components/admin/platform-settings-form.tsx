"use client";

import { updatePlatformSettingsSchema, type PlatformSettingsView } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import type { FormEvent } from "react";
import { Field } from "@/components/field";
import { Feedback } from "@/components/settings/feedback";
import { useSettingsMutation } from "@/components/settings/use-settings-mutation";
import { zodFieldErrors } from "@/lib/form-errors";

/** Contatos de suporte (tela de suspensão) e limite mensal padrão da IA. */
export function PlatformSettingsForm({ settings }: { settings: PlatformSettingsView }) {
  const { errors, setErrors, feedback, pending, submit } = useSettingsMutation();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const limit = String(form.get("defaultAiMonthlyLimitUsd") ?? "").trim().replace(",", ".");
    const body = {
      supportEmail: form.get("supportEmail"),
      supportWhatsapp: form.get("supportWhatsapp"),
      ...(limit === (settings.defaultAiMonthlyLimitUsd ?? "") ? {} : { defaultAiMonthlyLimitUsd: limit === "" ? null : Number(limit) }),
    };
    const parsed = updatePlatformSettingsSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    submit("PATCH", "/admin/platform-settings", body, "Configurações da plataforma salvas.");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Feedback value={feedback} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supportEmail" label="E-mail de suporte" optional error={errors["supportEmail"]}>
          <Input id="supportEmail" name="supportEmail" type="email" defaultValue={settings.supportEmail ?? ""} maxLength={254} />
        </Field>
        <Field id="supportWhatsapp" label="WhatsApp de suporte" optional error={errors["supportWhatsapp"]} hint="DDD + número (DDI 55 é presumido).">
          <Input id="supportWhatsapp" name="supportWhatsapp" inputMode="tel" defaultValue={settings.supportWhatsapp ?? ""} maxLength={30} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Mostrados na tela de empresa suspensa. Sem nenhum contato, a tela orienta o usuário a procurar o responsável da empresa.
      </p>
      <Field
        id="defaultAiMonthlyLimitUsd"
        label="Limite mensal padrão da IA (USD)"
        optional
        error={errors["defaultAiMonthlyLimitUsd"]}
        hint="Aplicado a empresas sem limite no momento em que a IA é habilitada. Mudá-lo não altera empresas que já têm limite."
      >
        <Input id="defaultAiMonthlyLimitUsd" name="defaultAiMonthlyLimitUsd" inputMode="decimal" defaultValue={settings.defaultAiMonthlyLimitUsd ?? ""} className="w-48" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
