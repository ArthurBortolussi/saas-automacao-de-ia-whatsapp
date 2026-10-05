import { cn } from "@arthur-ai/ui/lib/utils";
import type { ReactNode } from "react";

interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Ações no canto do cabeçalho (ex.: botão Editar). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Card de seção padrão: cabeçalho compacto com título/descrição e corpo. Base das telas de configurações, detalhes e
 * painéis — evita cada página reinventar padding e bordas.
 */
export function SectionCard({ title, description, actions, children, className, contentClassName }: SectionCardProps) {
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description ? <div className="text-[13px] text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("flex-1 p-5", contentClassName)}>{children}</div>
    </section>
  );
}
