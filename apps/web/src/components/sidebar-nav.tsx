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

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV: Record<"admin" | "company", NavGroup[]> = {
  admin: [
    { items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true }] },
    {
      label: "Plataforma",
      items: [
        { href: "/admin/companies", label: "Empresas", icon: Building2 },
        { href: "/admin/users", label: "Usuários", icon: Users },
        { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      ],
    },
    { label: "Sistema", items: [{ href: "/admin/settings", label: "Configurações", icon: Settings }] },
  ],
  company: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true }] },
    {
      label: "Atendimento",
      items: [
        { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
        { href: "/dashboard/contacts", label: "Contatos", icon: Contact },
      ],
    },
    {
      label: "Gestão",
      items: [
        { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, managersOnly: true },
        { href: "/dashboard/team", label: "Equipe", icon: UsersRound },
        { href: "/dashboard/knowledge-base", label: "Base de conhecimento", icon: BookOpen },
      ],
    },
    { label: "Empresa", items: [{ href: "/dashboard/settings", label: "Configurações", icon: Settings }] },
  ],
};

export function SidebarNav({ variant, isManager = true }: { variant: keyof typeof NAV; isManager?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5 pb-4" aria-label="Navegação">
      {NAV[variant].map((group, index) => {
        const items = group.items.filter((item) => isManager || !item.managersOnly);
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? index} className="space-y-1">
            {group.label ? <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{group.label}</p> : null}
            {items.map((item) => {
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
                    "group relative flex min-h-9 items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    active
                      ? "bg-sidebar-active font-medium text-white"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
                  )}
                >
                  {active ? <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand" /> : null}
                  <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
