"use client";

import { updateCompanyProfileSchema, type CompanySettingsResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { CompanyLogo } from "./company-logo";
import { ReadOnlyNote } from "./read-only-note";

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"];
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_BYTES = 512 * 1024;

/** Aba Empresa: nome comercial, fuso e logotipo (somente o proprietário). */
export function CompanyProfileForm({ data }: { data: CompanySettingsResponse }) {
  const router = useRouter();
  const { company, permissions } = data;
  const editable = permissions.editCompany;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: form.get("name"), timezone: form.get("timezone") };
    const parsed = updateCompanyProfileSchema.safeParse(body);
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate("PATCH", `/companies/${company.id}/settings/company`, parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setMessage({ kind: "success", text: "Dados salvos." });
      router.refresh();
    });
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMessage(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setMessage({ kind: "error", text: "Formato não aceito. Use PNG, JPEG ou WEBP." });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setMessage({ kind: "error", text: "O logotipo deve ter no máximo 512 KB." });
      return;
    }
    // Corpo binário com o tipo do arquivo; a API confere o conteúdo pelos bytes.
    const response = await fetch(`/api/companies/${company.id}/logo`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": file.type },
      body: file,
    }).catch(() => null);
    if (!response?.ok) {
      const error = (await response?.json().catch(() => null)) as { message?: string } | null;
      setMessage({ kind: "error", text: error?.message ?? "Não foi possível enviar o logotipo. O anterior foi mantido." });
      return;
    }
    setMessage({ kind: "success", text: "Logotipo atualizado." });
    router.refresh();
  }

  function removeLogo() {
    startTransition(async () => {
      const result = await apiMutate("DELETE", `/companies/${company.id}/logo`);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setMessage({ kind: "success", text: "Logotipo removido." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "success" ? <CheckCircle2 className="text-success" /> : null}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-3">
        <p className="text-sm font-medium">Logotipo</p>
        <div className="flex flex-wrap items-center gap-4">
          {company.logoVersion ? (
            <CompanyLogo companyId={company.id} version={company.logoVersion} name={company.name} size={72} />
          ) : (
            <span className="grid size-[72px] place-items-center rounded-md border border-dashed text-xs text-muted-foreground">Sem logo</span>
          )}
          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                Enviar imagem
                <input type="file" accept={LOGO_TYPES.join(",")} className="sr-only" onChange={(event) => void upload(event)} />
              </label>
              {company.logoVersion ? (
                <Button type="button" variant="outline" size="sm" onClick={removeLogo} disabled={pending}>
                  Remover
                </Button>
              ) : null}
              <p className="w-full text-xs text-muted-foreground">PNG, JPEG ou WEBP, até 512 KB. Aparece no menu lateral do painel.</p>
            </div>
          ) : null}
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Nome comercial" error={errors["name"]} hint="Usado no painel e pelo assistente para se apresentar.">
            <Input id="name" name="name" defaultValue={company.name} maxLength={120} />
          </Field>
          <Field id="timezone" label="Fuso horário" error={errors["timezone"]} hint="Vale para os três horários, datas especiais, relatórios e o mês de uso da IA.">
            <Input id="timezone" name="timezone" list="company-timezones" defaultValue={company.timezone} maxLength={64} />
          </Field>
          <datalist id="company-timezones">
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </fieldset>
        {editable ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        ) : (
          <ReadOnlyNote who="o proprietário da empresa" />
        )}
      </form>
    </div>
  );
}
