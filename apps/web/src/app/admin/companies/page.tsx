import type { CompanySummary, Paginated } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Card } from "@arthur-ai/ui/components/card";
import { Input } from "@arthur-ai/ui/components/input";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CompaniesTable } from "@/components/companies-table";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { fetchPageData } from "@/lib/api-server";

export const metadata: Metadata = { title: "Empresas" };

const PAGE_SIZE = 20;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function CompaniesPage({ searchParams }: PageProps<"/admin/companies">) {
  const params = await searchParams;
  const q = firstParam(params["q"]).slice(0, 100);
  const page = Math.max(1, Number.parseInt(firstParam(params["page"]), 10) || 1);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) query.set("q", q);
  const data = await fetchPageData<Paginated<CompanySummary>>(`/admin/companies?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Empresas"
        description={`${data.total} ${data.total === 1 ? "empresa" : "empresas"}${q ? ` encontradas para “${q}”` : ""}`}
        actions={
          <Button asChild>
            <Link href="/admin/companies/new">Nova empresa</Link>
          </Button>
        }
      />
      <form className="mb-4 flex max-w-sm gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Buscar por nome" aria-label="Buscar por nome" maxLength={100} className="pl-9" />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      <Card className="gap-0 py-0">
        <CompaniesTable
          companies={data.items}
          {...(q ? { emptyMessage: "Nenhuma empresa encontrada" } : {})}
        />
      </Card>
      <Pagination basePath="/admin/companies" page={data.page} pageSize={data.pageSize} total={data.total} params={q ? { q } : {}} />
    </>
  );
}
