import type { SupportContacts } from "@arthur-ai/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SuspendedScreen } from "@/components/suspended-screen";
import { fetchPageData, requireUser } from "@/lib/api-server";

export const metadata: Metadata = { title: "Acesso suspenso" };

/** Fase 7: tela exibida a usuários de empresa suspensa. Fora do layout do painel (sem menu). */
export default async function SuspendedPage() {
  const me = await requireUser();
  const company = me.membership?.company;
  if (!company || (company.status !== "PAUSED" && company.status !== "INACTIVE")) redirect("/");
  const support = await fetchPageData<SupportContacts>("/support");
  return <SuspendedScreen companyName={company.name} support={support} />;
}
