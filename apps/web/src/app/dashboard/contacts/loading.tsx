import { Skeleton } from "@arthur-ai/ui/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando contatos">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-80" />
      <div className="space-y-2 rounded-xl border p-5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
