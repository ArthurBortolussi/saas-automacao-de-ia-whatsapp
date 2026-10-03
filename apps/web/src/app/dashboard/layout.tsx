import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/api-server";

const SUSPENDED = new Set(["PAUSED", "INACTIVE"]);

// O bloqueio real de empresa suspensa é feito pela API (403 em toda rota da empresa); aqui só exibimos a tela.
export default async function CompanyAreaLayout({ children }: { children: ReactNode }) {
  const me = await requireUser();
  const membership = me.membership;
  if (!membership) {
    if (me.user.globalRole === "SUPERADMIN") redirect("/admin");
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <Alert className="max-w-md">
          <AlertTitle>Nenhuma empresa vinculada</AlertTitle>
          <AlertDescription>Sua conta não está vinculada a nenhuma empresa. Contate o suporte.</AlertDescription>
        </Alert>
      </main>
    );
  }

  // Fase 7: empresa suspensa → tela própria (/suspended), sem o restante do painel.
  if (SUSPENDED.has(membership.company.status)) redirect("/suspended");

  return (
    <AppShell variant="company" me={me} context={membership.company.name}>
      {children}
    </AppShell>
  );
}
