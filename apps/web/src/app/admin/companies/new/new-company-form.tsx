"use client";

import { BRAZILIAN_STATES, createCompanySchema, type CompanyDetail } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Textarea } from "@arthur-ai/ui/components/textarea";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";

const FIELDS = ["name", "legalName", "industry", "cnpj", "phone", "email", "website", "address", "city", "state", "businessHours"] as const;

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function NewCompanyForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(FIELDS.map((field) => [field, String(form.get(field) ?? "")]));
    const parsed = createCompanySchema.safeParse(input);
    setFormError(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate<CompanyDetail>("POST", "/admin/companies", parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setFormError(result.error.message);
        return;
      }
      router.push(`/admin/companies/${result.data.id}`);
      router.refresh();
    });
  }

  const input = (name: (typeof FIELDS)[number], props: ComponentProps<typeof Input> = {}) => (
    <Input id={name} name={name} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} {...props} />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <Section title="Identificação" description="Como a empresa aparece na plataforma.">
        <Field id="name" label="Nome" error={errors["name"]}>
          {input("name", { autoFocus: true, maxLength: 120 })}
        </Field>
        <Field id="legalName" label="Razão social" optional error={errors["legalName"]}>
          {input("legalName", { maxLength: 200 })}
        </Field>
        <Field id="industry" label="Segmento" error={errors["industry"]} hint="Ex.: Clínica odontológica, Imobiliária.">
          {input("industry", { maxLength: 80 })}
        </Field>
        <Field id="cnpj" label="CNPJ" optional error={errors["cnpj"]}>
          {input("cnpj", { inputMode: "text", placeholder: "00.000.000/0000-00", maxLength: 18 })}
        </Field>
      </Section>
      <Section title="Contato" description="Canais oficiais da empresa.">
        <Field id="phone" label="Telefone" error={errors["phone"]}>
          {input("phone", { type: "tel", placeholder: "(11) 99999-9999", maxLength: 20 })}
        </Field>
        <Field id="email" label="E-mail" optional error={errors["email"]}>
          {input("email", { type: "email", maxLength: 254 })}
        </Field>
        <Field id="website" label="Site" optional error={errors["website"]}>
          {input("website", { type: "url", placeholder: "https://", maxLength: 255 })}
        </Field>
      </Section>
      <Section title="Localização e funcionamento" description="Usado futuramente no atendimento.">
        <div className="sm:col-span-2">
          <Field id="address" label="Endereço" optional error={errors["address"]}>
            {input("address", { maxLength: 200 })}
          </Field>
        </div>
        <Field id="city" label="Cidade" optional error={errors["city"]}>
          {input("city", { maxLength: 80 })}
        </Field>
        <Field id="state" label="Estado" optional error={errors["state"]}>
          <NativeSelect id="state" name="state" defaultValue="" className="w-full" aria-invalid={!!errors["state"]}>
            <NativeSelectOption value="">Selecione</NativeSelectOption>
            {BRAZILIAN_STATES.map((uf) => (
              <NativeSelectOption key={uf} value={uf}>
                {uf}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <Field id="businessHours" label="Horário de funcionamento" optional error={errors["businessHours"]}>
            <Textarea
              id="businessHours"
              name="businessHours"
              rows={2}
              maxLength={200}
              placeholder="Seg a sex, 8h às 18h"
              aria-invalid={!!errors["businessHours"]}
            />
          </Field>
        </div>
      </Section>
      <div className="flex justify-end gap-2">
        <Button asChild variant="outline" type="button">
          <Link href="/admin/companies">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar empresa"}
        </Button>
      </div>
    </form>
  );
}
