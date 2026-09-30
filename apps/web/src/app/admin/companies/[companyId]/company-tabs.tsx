"use client";

import { cn } from "@arthur-ai/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "", label: "Visão geral" },
  { segment: "/users", label: "Usuários" },
  { segment: "/ai", label: "IA" },
  { segment: "/whatsapp", label: "WhatsApp" },
  { segment: "/knowledge-base", label: "Base de conhecimento" },
  { segment: "/usage", label: "Uso" },
];

// Abas como rotas: cada aba é renderizada no servidor e tem URL própria.
export function CompanyTabs({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const base = `/admin/companies/${companyId}`;

  return (
    <nav className="-mb-px flex gap-5 overflow-x-auto border-b" aria-label="Seções da empresa">
      {TABS.map((tab) => {
        const href = `${base}${tab.segment}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
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
