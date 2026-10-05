import { cn } from "@arthur-ai/ui/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  hint?: ReactNode;
  /** Selo no canto (ex.: "Agora · 14:32"). */
  tag?: string;
  muted?: boolean;
  icon?: ReactNode;
  /** Torna o card um atalho (ex.: abrir a Inbox já filtrada). */
  href?: string;
  /** Destaque de atenção (ex.: fila com gente esperando). Sempre acompanhado de texto, nunca só cor. */
  attention?: boolean;
}

/** Card de indicador: rótulo, número em destaque e uma linha de contexto. Mesmo componente no Dashboard e no Analytics. */
export function StatCard({ label, value, hint, tag, muted, icon, href, attention }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {tag ? (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{tag}</span>
        ) : icon ? (
          <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", attention ? "bg-warning-soft text-warning" : "bg-brand-soft text-brand-strong")}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className={cn("mt-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums", muted && "text-muted-foreground")}>{value}</p>
      {hint ? <div className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{hint}</div> : null}
    </>
  );
  const className = cn(
    "flex flex-col rounded-xl border bg-card px-5 py-4 shadow-card",
    attention && "border-warning/40",
    href && "transition-colors outline-none hover:border-brand/40 hover:bg-subtle focus-visible:ring-[3px] focus-visible:ring-ring/30",
  );
  return href ? (
    <Link href={href} prefetch={false} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
