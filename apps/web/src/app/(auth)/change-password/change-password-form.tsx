"use client";

import { changePasswordSchema, PASSWORD_MIN_LENGTH } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Input } from "@arthur-ai/ui/components/input";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";

export function ChangePasswordForm({ required }: { required: boolean }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      setErrors({ confirmPassword: "As senhas não conferem." });
      return;
    }
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate("POST", "/auth/change-password", parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setFormError(result.error.message);
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{required ? "Defina uma nova senha" : "Trocar senha"}</CardTitle>
        <CardDescription>
          {required
            ? "Por segurança, troque a senha inicial antes de continuar. As outras sessões abertas serão encerradas."
            : "As outras sessões abertas serão encerradas."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Field id="currentPassword" label="Senha atual" error={errors["currentPassword"]}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" autoFocus />
          </Field>
          <Field
            id="newPassword"
            label="Nova senha"
            error={errors["newPassword"]}
            hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
          >
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
          </Field>
          <Field id="confirmPassword" label="Confirme a nova senha" error={errors["confirmPassword"]}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Salvando…" : "Salvar nova senha"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
