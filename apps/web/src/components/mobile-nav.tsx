"use client";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@arthur-ai/ui/components/sheet";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Logo } from "./logo";

/** Barra superior abaixo de `lg`: logo, empresa em uso e o menu completo em drawer. */
export function MobileNav({ context, children }: { context: string; children: ReactNode }) {
  const pathname = usePathname();
  // Guarda em qual rota o drawer foi aberto: ao navegar, a rota muda e ele fecha sozinho.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean) => {
    setOpenAt(value ? pathname : null);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="grid size-10 place-items-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Menu</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
      <Logo tone="dark" />
      <span className="ml-auto max-w-[45%] truncate text-xs text-sidebar-foreground" title={context}>
        {context}
      </span>
    </header>
  );
}
