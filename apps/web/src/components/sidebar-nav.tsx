"use client";

import { cn } from "@arthur-ai/ui/lib/utils";
import {
  BarChart3,
  BookOpen,
  Building2,
  Contact,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Fase 6: só OWNER/ADMIN (a API também recusa; aqui só some do menu). */
  managersOnly?: boolean;
}

const NAV: Record<"admin" | "company", NavItem[]> = {
  admin: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/admin/companies", label: "Empresas", icon: Building2 },
    { href: "/admin/users", label: "Usuários", icon: Users },
    { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/admin/settings", label: "Configurações", icon: Settings },
  ],
  company: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
    { href: "/dashboard/contacts", label: "Contatos", icon: Contact },
    { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, managersOnly: true },
    { href: "/dashboard/knowledge-base", label: "Base de conhecimento", icon: BookOpen },
    { href: "/dashboard/team", label: "Equipe", icon: UsersRound },
    { href: "/dashboard/settings", label: "Configurações", icon: Settings },
  ],
};

export function SidebarNav({ variant, isManager = true }: { variant: keyof typeof NAV; isManager?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {NAV[variant].filter((item) => isManager || !item.managersOnly).map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            // Sem prefetch: páginas são dinâmicas e o polling da Inbox refaria esses prefetches a cada ciclo.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
