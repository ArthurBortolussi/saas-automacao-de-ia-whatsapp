"use client";

import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  createContactSchema,
  updateContactSchema,
  type ContactDetail,
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
import { CONTACT_SOURCE_LABEL, CONTACT_STATUS_LABEL } from "@/lib/format";

interface ContactFormProps {
  companyId: string;
  // Sem contato: cadastro. Com contato: edição.
  contact?: ContactDetail;
}

export function ContactForm({ companyId, contact }: ContactFormProps) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: form.get("name"),
      phone: form.get("phone"),
      email: form.get("email"),
      status: form.get("status"),
      source: form.get("source"),
      notes: form.get("notes"),
    };
    const parsed = contact ? updateContactSchema.safeParse(input) : createContactSchema.safeParse(input);
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = contact
        ? await apiMutate<ContactDetail>("PATCH", `/companies/${companyId}/contacts/${contact.id}`, parsed.data)
        : await apiMutate<ContactDetail>("POST", `/companies/${companyId}/contacts`, parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      if (contact) {
        setMessage({ kind: "success", text: "Alterações salvas." });
        router.refresh();
      } else {
        router.push(`/dashboard/contacts/${result.data.id}?created=1`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "success" ? <CheckCircle2 className="text-success" /> : null}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Nome" error={errors["name"]}>
          <Input id="name" name="name" defaultValue={contact?.name} maxLength={120} aria-invalid={!!errors["name"]} />
        </Field>
        <Field id="phone" label="Telefone" error={errors["phone"]} hint="DDD + número. Para outros países, use +DDI.">
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={contact ? `+${contact.phone}` : undefined}
            placeholder="(11) 99999-9999"
            maxLength={30}
            aria-invalid={!!errors["phone"]}
          />
        </Field>
        <Field id="email" label="E-mail" optional error={errors["email"]}>
          <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} aria-invalid={!!errors["email"]} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="status" label="Status" error={errors["status"]}>
            <NativeSelect id="status" name="status" defaultValue={contact?.status ?? "NEW"} className="w-full">
              {CONTACT_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {CONTACT_STATUS_LABEL[status]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field id="source" label="Origem" error={errors["source"]}>
            <NativeSelect id="source" name="source" defaultValue={contact?.source ?? "MANUAL"} className="w-full">
              {CONTACT_SOURCES.map((source) => (
                <NativeSelectOption key={source} value={source}>
                  {CONTACT_SOURCE_LABEL[source]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </div>
      <Field id="notes" label="Observações" optional error={errors["notes"]}>
        <Textarea id="notes" name="notes" rows={4} maxLength={2000} defaultValue={contact?.notes ?? ""} aria-invalid={!!errors["notes"]} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : contact ? "Salvar alterações" : "Cadastrar contato"}
        </Button>
      </div>
    </form>
  );
}
