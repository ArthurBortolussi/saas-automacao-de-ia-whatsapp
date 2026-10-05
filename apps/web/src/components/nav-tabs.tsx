"use client";

import { cn } from "@arthur-ai/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavTab {
  href: string;
  label: string;
}

/**
 * Abas como rotas (cada aba tem URL própria e é renderizada no servidor). Usadas em Configurações e nas seções de
 * uma empresa no Super Admin. Rolagem horizontal no mobile.
 */
export function NavTabs({ tabs, label }: { tabs: NavTab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="scroll-thin mb-6 -mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" aria-label={label}>
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px inline-flex h-10 items-center rounded-t-md px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span aria-hidden className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", active ? "bg-brand-strong" : "bg-transparent")} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
