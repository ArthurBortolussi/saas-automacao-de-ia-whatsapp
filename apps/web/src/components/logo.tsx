import { cn } from "@arthur-ai/ui/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-foreground", className)}>
      <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">
        A
      </span>
      <span>
        Arthur <span className="text-brand">AI</span>
      </span>
    </span>
  );
}
