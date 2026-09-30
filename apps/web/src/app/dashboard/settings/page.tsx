import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Configurações" };

export default function Page() {
  return (
    <>
      <PageHeader title="Configurações" />
      <PlaceholderPanel icon={<Settings />} title="Configurações" description="Preferências da sua empresa na plataforma. Disponível em uma próxima fase." />
    </>
  );
}
