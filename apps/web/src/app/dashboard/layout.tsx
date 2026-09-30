import { Alert, AlertDescription, AlertTitle } from "@arthur-ai/ui/components/alert";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/api-server";

const SUSPENDED = new Set(["PAUSED", "INACTIVE"]);

// O bloqueio real de empresa suspensa é feito pela API (403); aqui só exibimos o aviso.
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

  return (
    <AppShell variant="company" me={me} context={membership.company.name}>
      {SUSPENDED.has(membership.company.status) ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertTitle>Acesso suspenso</AlertTitle>
          <AlertDescription>O acesso da sua empresa está suspenso. Contate o suporte.</AlertDescription>
        </Alert>
      ) : (
        children
      )}
    </AppShell>
  );
}
