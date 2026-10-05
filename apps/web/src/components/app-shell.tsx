import type { MeResponse } from "@arthur-ai/shared";
import type { ReactNode } from "react";
import { MEMBER_ROLE_LABEL } from "@/lib/format";
import { Logo } from "./logo";
import { LogoutButton } from "./logout-button";
import { MobileNav } from "./mobile-nav";
import { CompanyLogo } from "./settings/company-logo";
import { SidebarNav } from "./sidebar-nav";
import { AvailabilityControl } from "./team/availability-control";

interface AppShellProps {
  variant: "admin" | "company";
  me: MeResponse;
  context: string;
  children: ReactNode;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Shell da aplicação: sidebar escura fixa a partir de `lg`; abaixo disso, barra superior com o menu em drawer.
 * O conteúdo da sidebar é o mesmo nas duas formas (renderizado no servidor e reaproveitado no drawer).
 */
export function AppShell({ variant, me, context, children }: AppShellProps) {
  const membership = me.membership;
  const contextLabel = variant === "admin" ? "Super Admin" : membership ? MEMBER_ROLE_LABEL[membership.role] : "";

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo tone="dark" />
      </div>

      {/* Contexto: qual empresa (ou a plataforma) está em uso. */}
      <div className="mx-3 mb-4 flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-surface px-3 py-2.5">
        {membership?.company.logoVersion ? (
          <CompanyLogo companyId={membership.company.id} version={membership.company.logoVersion} name={context} size={32} />
        ) : (
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-accent text-xs font-semibold text-white">
            {variant === "admin" ? "VX" : initialsOf(context)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white" title={context}>
            {context}
          </p>
          <p className="truncate text-xs text-sidebar-muted">{contextLabel}</p>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3">
        <SidebarNav variant={variant} isManager={membership?.role !== "AGENT"} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
        {variant === "company" && membership ? (
          <AvailabilityControl companyId={membership.company.id} availability={membership.availability} />
        ) : null}
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-strong text-xs font-semibold text-white">
            {initialsOf(me.user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{me.user.name}</p>
            <p className="truncate text-xs text-sidebar-muted">{me.user.email}</p>
          </div>
          <LogoutButton tone="dark" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block" aria-label="Menu principal">
        {sidebar}
      </aside>
      <MobileNav context={context}>{sidebar}</MobileNav>
      <main id="conteudo" className="min-w-0 lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
