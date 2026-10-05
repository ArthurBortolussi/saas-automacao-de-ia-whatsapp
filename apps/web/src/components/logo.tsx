import { cn } from "@arthur-ai/ui/lib/utils";
import { useId } from "react";

/**
 * Símbolo da Vortrix AI: duas faixas diagonais que formam o monograma V + X, com degradê índigo → violeta e a dobra
 * clara no cruzamento. É uma APROXIMAÇÃO em SVG do guia de marca (a referência recebida é raster). Ao receber o vetor
 * definitivo, troque as formas e paradas abaixo e os arquivos de public/brand/ + app/icon.svg (mesma geometria 64×64).
 * As cores do símbolo são parte do asset (como os SVGs de public/brand/), por isso ficam aqui e não em tokens.
 */
const MARK = {
  viewBox: "0 0 64 64",
  back: "M2 7h17L62 57H45Z",
  front: "M43 7h17L37 57H20Z",
  backStops: [
    ["0", "#4338CA"],
    ["0.55", "#6656EE"],
    ["1", "#8B5CF6"],
  ],
  frontStops: [
    ["0", "#8B5CF6"],
    ["0.44", "#C7B4FB"],
    ["0.6", "#7A68F2"],
    ["1", "#4F46E5"],
  ],
} as const;

export function VortrixMark({ className, title }: { className?: string; title?: string }) {
  // IDs únicos por instância: o mesmo símbolo aparece na sidebar oculta e na barra do mobile, e um degradê definido
  // dentro de um SVG com display:none não pinta as outras cópias.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox={MARK.viewBox}
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-back`} x1="2" y1="7" x2="62" y2="57" gradientUnits="userSpaceOnUse">
          {MARK.backStops.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}-front`} x1="60" y1="7" x2="22" y2="57" gradientUnits="userSpaceOnUse">
          {MARK.frontStops.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={MARK.back} />
        </clipPath>
      </defs>
      <path d={MARK.back} fill={`url(#${id}-back)`} />
      {/* Sombra discreta da faixa da frente sobre a de trás: dá a sensação de dobra/sobreposição da referência. */}
      <path d={MARK.front} transform="translate(2.2 0)" fill="#1E1B4B" fillOpacity="0.28" clipPath={`url(#${id}-clip)`} />
      <path d={MARK.front} fill={`url(#${id}-front)`} />
    </svg>
  );
}

/** Símbolo + wordmark. `tone="dark"` para fundos midnight (sidebar, barra do mobile, login), `light` para fundos claros. */
export function Logo({ className, tone = "light", compact = false }: { className?: string; tone?: "light" | "dark"; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <VortrixMark />
      {compact ? (
        <span className="sr-only">Vortrix AI</span>
      ) : (
        <span className={cn("text-[17px] leading-none font-bold tracking-[-0.02em]", tone === "dark" ? "text-white" : "text-foreground")}>
          Vortrix <span className={tone === "dark" ? "text-brand-violet" : "text-brand-strong"}>AI</span>
        </span>
      )}
    </span>
  );
}
