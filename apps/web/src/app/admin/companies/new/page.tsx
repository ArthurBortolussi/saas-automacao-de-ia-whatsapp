import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NewCompanyForm } from "./new-company-form";

export const metadata: Metadata = { title: "Nova empresa" };

export default function NewCompanyPage() {
  return (
    <>
      <Link href="/admin/companies" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Empresas
      </Link>
      <PageHeader title="Nova empresa" description="A empresa é criada com status Onboarding." />
      <NewCompanyForm />
    </>
  );
}
