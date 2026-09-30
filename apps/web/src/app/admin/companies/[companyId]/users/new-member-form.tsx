"use client";

import { createCompanyMemberSchema, MEMBER_ROLES, PASSWORD_MIN_LENGTH } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { MEMBER_ROLE_LABEL } from "@/lib/format";

export function NewMemberForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createCompanyMemberSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
    });
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate("POST", `/admin/companies/${companyId}/members`, parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      formRef.current?.reset();
      setMessage({ kind: "success", text: `Usuário ${parsed.data.email} criado. Ele deverá trocar a senha no primeiro acesso.` });
      router.refresh();
    });
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="text-base">Novo usuário</CardTitle>
        <CardDescription>Compartilhe a senha inicial por um canal seguro.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
          {message ? (
            <Alert variant={message.kind === "error" ? "destructive" : "default"}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          ) : null}
          <Field id="member-name" label="Nome" error={errors["name"]}>
            <Input id="member-name" name="name" maxLength={120} aria-invalid={!!errors["name"]} />
          </Field>
          <Field id="member-email" label="E-mail" error={errors["email"]}>
            <Input id="member-email" name="email" type="email" maxLength={254} aria-invalid={!!errors["email"]} />
          </Field>
          <Field id="member-password" label="Senha inicial" error={errors["password"]} hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}>
            <Input id="member-password" name="password" type="password" autoComplete="new-password" aria-invalid={!!errors["password"]} />
          </Field>
          <Field id="member-role" label="Função" error={errors["role"]}>
            <NativeSelect id="member-role" name="role" defaultValue="OWNER" className="w-full">
              {MEMBER_ROLES.map((role) => (
                <NativeSelectOption key={role} value={role}>
                  {MEMBER_ROLE_LABEL[role]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Criando…" : "Criar usuário"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
