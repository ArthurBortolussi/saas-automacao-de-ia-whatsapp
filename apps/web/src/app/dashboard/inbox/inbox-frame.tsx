import { cn } from "@arthur-ai/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * Moldura de tela cheia da Inbox: anula o padding do shell e ocupa a altura útil (abaixo da barra superior no
 * mobile; a tela inteira com a sidebar fixa a partir de `lg`).
 */
export function InboxFrame({ children, className, ...props }: { children: ReactNode; className?: string } & ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-card sm:-mx-6 lg:-mx-10 lg:-my-8 lg:h-dvh",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
