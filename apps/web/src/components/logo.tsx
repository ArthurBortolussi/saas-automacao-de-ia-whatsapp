import { cn } from "@arthur-ai/ui/lib/utils";

/**
 * Identidade Vortrix AI. Símbolo provisório (monograma geométrico V + X) desenhado em SVG inline com os tokens da
 * marca. Para trocar pelo símbolo definitivo, substitua o conteúdo de <VortrixMark> (e os arquivos em
 * public/brand/ + app/icon.svg). O restante da interface só usa <Logo> e <VortrixMark>.
 */
export function VortrixMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" fill="var(--brand-strong)" />
      <path d="M8.5 9 16 23.5 23.5 9" fill="none" stroke="var(--vx-white)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 13.5 22.5 23.5" fill="none" stroke="var(--vx-lavender)" strokeOpacity="0.75" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Símbolo + wordmark. `tone="dark"` para fundos escuros (sidebar), `light` para fundos claros. */
export function Logo({ className, tone = "light", compact = false }: { className?: string; tone?: "light" | "dark"; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <VortrixMark />
      {compact ? (
        <span className="sr-only">Vortrix AI</span>
      ) : (
        <span className={cn("text-[15px]", tone === "dark" ? "text-white" : "text-foreground")}>
          Vortrix <span className={tone === "dark" ? "text-sidebar-foreground" : "text-brand-strong"}>AI</span>
        </span>
      )}
    </span>
  );
}
