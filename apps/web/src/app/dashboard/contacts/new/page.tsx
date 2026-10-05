import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Novo contato" };

export default async function NewContactPage() {
  const { companyId } = await requireMembership();
  return (
    <>
      <PageHeader back={{ href: "/dashboard/contacts", label: "Contatos" }} title="Novo contato" description="Cadastre um cliente da empresa para iniciar conversas e acompanhar o histórico." />
      <SectionCard title="Dados do contato" className="max-w-3xl">
        <ContactForm companyId={companyId} />
      </SectionCard>
    </>
  );
}
