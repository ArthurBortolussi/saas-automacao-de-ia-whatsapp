import { Contact } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Contatos" };

export default function Page() {
  return (
    <>
      <PageHeader title="Contatos" />
      <PlaceholderPanel icon={<Contact />} title="Contatos" description="Os contatos dos clientes atendidos ficarão organizados aqui. Disponível em uma próxima fase." />
    </>
  );
}
