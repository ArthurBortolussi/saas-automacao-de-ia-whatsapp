"use client";

import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { Button } from "@arthur-ai/ui/components/button";
import { useState, type ReactNode } from "react";

interface Props {
  /** Texto do botão que inicia a ação. */
  label: string;
  /** Título e efeito objetivo da operação, mostrados antes de confirmar. */
  title: string;
  effect: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  size?: "default" | "sm";
}

/**
 * Fase 7: confirmação explícita de operações críticas (pausar a IA, alterar permissões, suspender empresa).
 * O backend também exige { confirm: true }: esta etapa é para a pessoa entender o efeito antes de seguir.
 */
export function ConfirmAction({ label, title, effect, confirmLabel, destructive = false, disabled, pending, onConfirm, size = "default" }: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        type="button"
        size={size}
        variant={destructive ? "destructive" : "default"}
        disabled={disabled ?? pending}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }
  return (
    <Alert variant={destructive ? "destructive" : "default"} className="max-w-xl" role="alertdialog" aria-label={title}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <div>{effect}</div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {pending ? "Aguarde…" : confirmLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancelar
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
