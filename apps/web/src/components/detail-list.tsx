import type { ReactNode } from "react";

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-3 sm:gap-4">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="break-words sm:col-span-2">{item.value || <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
