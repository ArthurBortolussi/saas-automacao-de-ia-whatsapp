"use client";

import type { DailyPoint } from "@arthur-ai/shared";
import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { SERIES } from "./chart-colors";

const HEIGHT = 160;

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate * 4 >= value) ?? magnitude * 10;
  return step * 4;
}

const dayLabel = (date: string) => date.slice(8, 10) + "/" + date.slice(5, 7);

/**
 * Atendimentos iniciados por dia (fuso do relatório), empilhados em: somente IA, atendimento humano e demais.
 * Mesmos dados dos cards; a tabela abaixo traz os números exatos.
 */
export function DailyChart({ daily }: { daily: DailyPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...daily.map((point) => point.started)));
  const ticks = [max, max / 2, 0];
  const point = active === null ? null : daily[active];
  const dense = daily.length > 14;

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {[SERIES.aiOnly, SERIES.withHuman, { color: SERIES.other.color, label: "Demais" }].map((series) => (
          <li key={series.label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: series.color }} aria-hidden="true" />
            {series.label}
          </li>
        ))}
      </ul>

      <div className="relative flex gap-2">
        <div className="flex w-8 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: HEIGHT }}>
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatNumber(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: HEIGHT }} aria-hidden="true">
            {ticks.map((tick) => (
              <div key={tick} className="h-px w-full bg-border" />
            ))}
          </div>
          <div className="relative flex items-end gap-[2px]" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
            {daily.map((day, index) => {
              const rest = Math.max(0, day.started - day.aiOnly - day.withHuman);
              const segments = [
                { value: day.aiOnly, color: SERIES.aiOnly.color },
                { value: day.withHuman, color: SERIES.withHuman.color },
                { value: rest, color: SERIES.other.color },
              ].filter((segment) => segment.value > 0);
              return (
                <button
                  key={day.date}
                  type="button"
                  className="flex h-full flex-1 cursor-default flex-col items-center justify-end rounded-sm outline-none focus-visible:bg-muted/60 hover:bg-muted/40"
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  aria-label={`${dayLabel(day.date)}: ${day.started} atendimentos iniciados, ${day.aiOnly} somente IA, ${day.withHuman} com atendimento humano, ${day.closed} encerrados`}
                >
                  <span className="flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: `${(day.started / max) * 100}%` }}>
                    {segments.map((segment, position) => (
                      <span
                        key={segment.color}
                        className={position === segments.length - 1 ? "rounded-t" : ""}
                        style={{ flexGrow: segment.value, backgroundColor: segment.color, minHeight: 2 }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[2px] text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
            {daily.map((day, index) => (
              <span key={day.date} className="flex-1 text-center">
                {!dense || index % 5 === 0 || index === daily.length - 1 ? dayLabel(day.date) : ""}
              </span>
            ))}
          </div>
          {point ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-52 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
              style={{
                left: `min(max(0px, calc(${((active ?? 0) + 0.5) / daily.length} * 100% - 6.5rem)), calc(100% - 13rem))`,
              }}
              role="status"
            >
              <p className="mb-1 font-medium">{dayLabel(point.date)}</p>
              <p className="flex justify-between">
                <span>Iniciados</span>
                <span className="tabular-nums">{formatNumber(point.started)}</span>
              </p>
              {[
                { label: SERIES.aiOnly.label, value: point.aiOnly, color: SERIES.aiOnly.color },
                { label: SERIES.withHuman.label, value: point.withHuman, color: SERIES.withHuman.color },
                { label: "Demais", value: Math.max(0, point.started - point.aiOnly - point.withHuman), color: SERIES.other.color },
              ].map((row) => (
                <p key={row.label} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: row.color }} aria-hidden="true" />
                    {row.label}
                  </span>
                  <span className="tabular-nums text-foreground">{formatNumber(row.value)}</span>
                </p>
              ))}
              <p className="mt-1 flex justify-between border-t pt-1">
                <span>Encerrados no dia</span>
                <span className="tabular-nums">{formatNumber(point.closed)}</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver os números em tabela</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Dia</th>
                <th className="px-3 py-1.5 text-right font-medium">Iniciados</th>
                <th className="px-3 py-1.5 text-right font-medium">Somente IA</th>
                <th className="px-3 py-1.5 text-right font-medium">Atendimento humano</th>
                <th className="px-3 py-1.5 text-right font-medium">Encerrados</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date} className="border-t">
                  <td className="px-3 py-1.5">{day.date.split("-").reverse().join("/")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(day.started)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(day.aiOnly)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(day.withHuman)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(day.closed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
