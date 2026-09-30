import type { MeResponse } from "@arthur-ai/shared";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { LogoutButton } from "./logout-button";
import { SidebarNav } from "./sidebar-nav";

interface AppShellProps {
  variant: "admin" | "company";
  me: MeResponse;
  context: string;
  children: ReactNode;
}

export function AppShell({ variant, me, context, children }: AppShellProps) {
  const initials = me.user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="min-h-dvh md:flex">
      <aside className="flex flex-col gap-4 border-b border-sidebar-border bg-sidebar px-3 py-3 md:fixed md:inset-y-0 md:w-60 md:border-r md:border-b-0 md:py-4">
        <div className="flex items-center justify-between px-2 md:block">
          <Logo />
          <p className="hidden truncate pt-1 text-xs text-muted-foreground md:block">{context}</p>
          <div className="md:hidden">
            <LogoutButton />
          </div>
        </div>
        <SidebarNav variant={variant} />
        <div className="mt-auto hidden items-center gap-2.5 rounded-md border border-sidebar-border bg-background px-2.5 py-2 md:flex">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
