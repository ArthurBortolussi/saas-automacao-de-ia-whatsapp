import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import type { ReactNode } from "react";

/** Estado vazio profissional para módulos ainda não disponíveis. Sem dados fictícios. */
export function PlaceholderPanel({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <Empty className="border border-dashed bg-card py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">Em breve</span>
    </Empty>
  );
}
