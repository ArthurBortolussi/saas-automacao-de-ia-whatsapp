"use client";

import { Button } from "@arthur-ai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@arthur-ai/ui/components/dialog";
import { cn } from "@arthur-ai/ui/lib/utils";
import { AlertTriangle } from "lucide-react";
import { useState, type ReactNode } from "react";

interface Props {
  /** Texto do botão que inicia a ação. */
  label: ReactNode;
  /** Título e efeito objetivo da operação, mostrados antes de confirmar. */
  title: string;
  effect: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  size?: "default" | "sm";
  /** Aparência do botão que abre a confirmação (o botão de confirmar segue `destructive`). */
  triggerVariant?: "default" | "outline" | "destructive" | "destructive-outline" | "ghost";
  triggerClassName?: string;
}

/**
 * Confirmação explícita de operações críticas (pausar a IA, alterar permissões, suspender empresa, excluir...).
 * Modal acessível (foco preso, Esc cancela). Quando o backend também exige { confirm: true }, esta etapa é para a
 * pessoa entender o efeito antes de seguir.
 */
export function ConfirmAction({
  label,
  title,
  effect,
  confirmLabel,
  destructive = false,
  disabled,
  pending,
  onConfirm,
  size = "default",
  triggerVariant,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={triggerVariant ?? (destructive ? "destructive" : "default")}
          disabled={disabled ?? pending}
          className={triggerClassName}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {destructive ? (
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive-soft text-destructive">
                <AlertTriangle className="size-4" />
              </span>
            ) : null}
            <div className="space-y-1.5 pt-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription asChild>
                <div className={cn("text-sm text-muted-foreground", "[&_ul]:mt-1")}>{effect}</div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {pending ? "Aguarde…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
