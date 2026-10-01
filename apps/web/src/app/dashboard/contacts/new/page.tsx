import { Card, CardContent } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
import { PageHeader } from "@/components/page-header";
import { requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Novo contato" };

export default async function NewContactPage() {
  const { companyId } = await requireMembership();
  return (
    <>
      <Link href="/dashboard/contacts" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Contatos
      </Link>
      <PageHeader title="Novo contato" />
      <Card className="max-w-3xl">
        <CardContent>
          <ContactForm companyId={companyId} />
        </CardContent>
      </Card>
    </>
  );
}
