import { Card } from "@arthur-ai/ui/components/card";
import type { ReactNode } from "react";

export function StatCard({ label, value, hint, tag, muted }: { label: string; value: string; hint?: ReactNode; tag?: string; muted?: boolean }) {
  return (
    <Card className="gap-1 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {tag ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tag}</span> : null}
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</p>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
