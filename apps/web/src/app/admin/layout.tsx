import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/api-server";

// O redirecionamento aqui é conveniência de UX; os endpoints /api/admin/* exigem SUPERADMIN no backend.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireUser();
  if (me.user.globalRole !== "SUPERADMIN") redirect("/dashboard");
  return (
    <AppShell variant="admin" me={me} context="Administração da plataforma">
      {children}
    </AppShell>
  );
}
