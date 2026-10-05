import { useId } from "react";

/**
 * Composição abstrata do painel de login: as duas faixas do símbolo Vortrix AI ampliadas e cortadas pela borda, com um
 * brilho suave no cruzamento. Puramente decorativa (aria-hidden), estática e sem imagem raster. Junto com o símbolo,
 * é o ÚNICO lugar da interface com degradê.
 */
export function BrandBackdrop() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-back`} x1="80" y1="40" x2="760" y2="760" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--vx-indigo-deep)" }} stopOpacity="0.42" />
          <stop offset="1" style={{ stopColor: "var(--vx-violet)" }} stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id={`${id}-front`} x1="700" y1="0" x2="260" y2="820" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--vx-violet)" }} stopOpacity="0.45" />
          <stop offset="0.42" style={{ stopColor: "var(--vx-lavender)" }} stopOpacity="0.4" />
          <stop offset="0.6" style={{ stopColor: "var(--vx-indigo)" }} stopOpacity="0.32" />
          <stop offset="1" style={{ stopColor: "var(--vx-indigo-strong)" }} stopOpacity="0.06" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: "var(--vx-violet)" }} stopOpacity="0.32" />
          <stop offset="1" style={{ stopColor: "var(--vx-violet)" }} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" style={{ stopColor: "var(--vx-midnight)" }} stopOpacity="0" />
          <stop offset="0.85" style={{ stopColor: "var(--vx-midnight)" }} stopOpacity="0.92" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <circle cx="500" cy="320" r="260" fill={`url(#${id}-glow)`} />
      <g filter={`url(#${id}-soft)`}>
        <path d="M190 -60h150L860 600H710Z" fill={`url(#${id}-back)`} />
        <path d="M700 -60h150L470 820H320Z" fill={`url(#${id}-front)`} />
      </g>
      {/* Escurece a parte de baixo, onde fica o texto, para manter o contraste. */}
      <rect width="600" height="900" fill={`url(#${id}-fade)`} />
    </svg>
  );
}
