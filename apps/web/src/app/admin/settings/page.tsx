import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Configurações" };

export default function AdminSettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Preferências globais da plataforma." />
      <PlaceholderPanel
        icon={<Settings />}
        title="Configurações da plataforma"
        description="Provedores de IA, integrações e parâmetros globais serão configurados aqui em uma próxima fase."
      />
    </>
  );
}
