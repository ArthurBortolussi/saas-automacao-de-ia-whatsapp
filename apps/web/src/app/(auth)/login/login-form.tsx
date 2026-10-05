"use client";

import { loginSchema, type MeResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { homePathFor } from "@/lib/routes";

export function LoginForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
    setFormError(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate<MeResponse>("POST", "/auth/login", parsed.data);
      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }
      router.replace(homePathFor(result.data));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar na Vortrix AI</h1>
        <p className="text-sm text-muted-foreground">Acesse com as credenciais fornecidas pela sua empresa.</p>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-card">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Field id="email" label="E-mail" error={errors["email"]}>
            <Input id="email" name="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors["email"]} />
          </Field>
          <Field id="password" label="Senha" error={errors["password"]}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors["password"]}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
