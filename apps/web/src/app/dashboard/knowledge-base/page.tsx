import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Base de conhecimento" };

export default function Page() {
  return (
    <>
      <PageHeader title="Base de conhecimento" />
      <PlaceholderPanel icon={<BookOpen />} title="Base de conhecimento" description="Informações da empresa que o assistente usará para responder. Disponível em uma próxima fase." />
    </>
  );
}
