import { Skeleton } from "@arthur-ai/ui/components/skeleton";

export default function Loading() {
  return (
    <div
      className="-mx-4 -my-6 flex h-[calc(100dvh-7.5rem)] border-y bg-card md:-mx-10 md:-my-10 md:h-dvh md:border-y-0"
      aria-busy="true"
      aria-label="Carregando conversas"
    >
      <div className="w-full space-y-3 border-r p-4 md:w-80">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <div className="hidden flex-1 flex-col gap-3 p-6 md:flex">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="ml-auto h-12 w-2/5" />
        <Skeleton className="h-12 w-1/3" />
      </div>
    </div>
  );
}
