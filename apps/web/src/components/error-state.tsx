"use client";

import { Button } from "@arthur-ai/ui/components/button";
import { AlertCircle, RotateCw } from "lucide-react";

/**
 * Estado de erro padrão das páginas (usado pelos error.tsx). Sem detalhes técnicos: em produção o Next já oculta a
 * mensagem do servidor; aqui só oferecemos tentar de novo.
 */
export function ErrorState({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center shadow-card">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-destructive-soft text-destructive">
        <AlertCircle className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">Não foi possível carregar esta página</h2>
        <p className="text-sm text-muted-foreground">Verifique a conexão e tente novamente. Se o problema continuar, fale com o suporte.</p>
      </div>
      <Button variant="outline" onClick={reset}>
        <RotateCw /> Tentar novamente
      </Button>
    </div>
  );
}
