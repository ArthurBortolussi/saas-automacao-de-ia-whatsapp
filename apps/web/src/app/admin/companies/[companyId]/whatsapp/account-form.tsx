"use client";

import { updateWhatsAppAccountSchema, type WhatsAppAccountAdminView } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { Input } from "@arthur-ai/ui/components/input";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";

interface Props {
  companyId: string;
  account: WhatsAppAccountAdminView | null;
  disabled: boolean;
}

export function WhatsAppAccountForm({ companyId, account, disabled }: Props) {
  const router = useRouter();
  const tokenRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = updateWhatsAppAccountSchema.safeParse({
      wabaId: form.get("wabaId"),
      phoneNumberId: form.get("phoneNumberId"),
      displayPhoneNumber: form.get("displayPhoneNumber"),
      verifiedName: form.get("verifiedName"),
      accessToken: form.get("accessToken"),
    });
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    if (!account && !parsed.data.accessToken) {
      setErrors({ accessToken: "Informe o token de acesso." });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await apiMutate("PUT", `/admin/companies/${companyId}/whatsapp`, parsed.data);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      // O token digitado sai do formulário assim que é salvo.
      if (tokenRef.current) tokenRef.current.value = "";
      setMessage({ kind: "success", text: "Configuração salva. Use “Testar conexão” para validar com a Meta." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" autoComplete="off">
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "success" ? <CheckCircle2 className="text-success" /> : null}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="wabaId" label="WABA ID" error={errors["wabaId"]} hint="ID da conta do WhatsApp Business.">
          <Input id="wabaId" name="wabaId" inputMode="numeric" defaultValue={account?.wabaId} disabled={disabled} />
        </Field>
        <Field id="phoneNumberId" label="Phone Number ID" error={errors["phoneNumberId"]} hint="Identificador do número na Meta (não é o telefone).">
          <Input id="phoneNumberId" name="phoneNumberId" inputMode="numeric" defaultValue={account?.phoneNumberId} disabled={disabled} />
        </Field>
        <Field id="displayPhoneNumber" label="Número de telefone" error={errors["displayPhoneNumber"]}>
          <Input id="displayPhoneNumber" name="displayPhoneNumber" placeholder="+55 11 4000-0000" defaultValue={account?.displayPhoneNumber} disabled={disabled} />
        </Field>
        <Field id="verifiedName" label="Nome de exibição" optional error={errors["verifiedName"]}>
          <Input id="verifiedName" name="verifiedName" defaultValue={account?.verifiedName ?? ""} disabled={disabled} />
        </Field>
      </div>
      <Field
        id="accessToken"
        label="Token de acesso"
        optional={Boolean(account)}
        error={errors["accessToken"]}
        hint={
          account
            ? "Deixe em branco para manter o token atual. Ele é guardado criptografado e nunca é exibido."
            : "Token de usuário do sistema (System User) com permissão whatsapp_business_messaging. Guardado criptografado."
        }
      >
        <Input ref={tokenRef} id="accessToken" name="accessToken" type="password" autoComplete="new-password" disabled={disabled} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || disabled}>
          {pending ? "Salvando…" : account ? "Salvar alterações" : "Conectar número"}
        </Button>
      </div>
    </form>
  );
}
