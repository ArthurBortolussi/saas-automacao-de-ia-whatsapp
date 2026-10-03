"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, type FieldErrors } from "@/lib/form-errors";

type Feedback = { kind: "error" | "success"; text: string } | null;

/** Envio padrão das abas de configurações: erros por campo, mensagem e atualização da página no sucesso. */
export function useSettingsMutation() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  function submit(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, success: string, onDone?: () => void) {
    setFeedback(null);
    startTransition(async () => {
      const result = await apiMutate(method, path, body);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setFeedback({ kind: "error", text: result.error.message });
        return;
      }
      setErrors({});
      setFeedback({ kind: "success", text: success });
      onDone?.();
      router.refresh();
    });
  }

  return { errors, setErrors, feedback, setFeedback, pending, submit };
}
