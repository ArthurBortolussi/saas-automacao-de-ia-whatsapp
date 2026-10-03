"use client";

import { cn } from "@arthur-ai/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "", label: "Empresa" },
  { segment: "/ai", label: "IA" },
  { segment: "/service", label: "Atendimento" },
  { segment: "/hours", label: "Horários" },
  { segment: "/messages", label: "Mensagens" },
  { segment: "/permissions", label: "Permissões" },
];

// Abas como rotas (mesmo padrão das abas do admin): cada aba tem URL própria e é renderizada no servidor.
export function SettingsTabs() {
  const pathname = usePathname();
  const base = "/dashboard/settings";
  return (
    <nav className="-mb-px mb-6 flex gap-5 overflow-x-auto border-b" aria-label="Seções das configurações">
      {TABS.map((tab) => {
        const href = `${base}${tab.segment}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 pb-2.5 text-sm transition-colors",
              active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
