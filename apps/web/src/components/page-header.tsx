import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Link de retorno acima do título (ex.: "Contatos"). */
  back?: { href: string; label: string };
  /** Selos ao lado do título (status etc.). */
  badges?: ReactNode;
}

/** Cabeçalho padrão de página: onde estou, o que é esta tela e a ação principal (à direita). */
export function PageHeader({ title, description, actions, back, badges }: PageHeaderProps) {
  return (
    <div className="mb-6 space-y-3 lg:mb-8">
      {back ? (
        <Link
          href={back.href}
          prefetch={false}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <ChevronLeft className="size-4" /> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
            {badges}
          </div>
          {description ? <div className="max-w-3xl text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
