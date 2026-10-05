import { Skeleton } from "@arthur-ai/ui/components/skeleton";
import { InboxFrame } from "./inbox-frame";

export default function Loading() {
  return (
    <InboxFrame aria-busy="true" aria-label="Carregando conversas">
      <div className="w-full space-y-4 border-r p-4 md:w-[340px]">
        <Skeleton className="h-6 w-24" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden flex-1 flex-col gap-4 bg-subtle p-6 md:flex">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-14 w-2/5" />
        <Skeleton className="ml-auto h-14 w-2/5" />
        <Skeleton className="h-14 w-1/3" />
      </div>
    </InboxFrame>
  );
}
