import { CONTACT_STATUSES, formatPhoneNumber, type ContactStatus, type ContactSummary, type Paginated } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Card } from "@arthur-ai/ui/components/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { Contact, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactStatusBadge } from "@/components/contact-badges";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { fetchPageData, requireMembership } from "@/lib/api-server";
import { CONTACT_SOURCE_LABEL, CONTACT_STATUS_LABEL, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Contatos" };

const PAGE_SIZE = 20;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function ContactsPage({ searchParams }: PageProps<"/dashboard/contacts">) {
  const { companyId } = await requireMembership();
  const params = await searchParams;
  const q = firstParam(params["q"]).slice(0, 100);
  const statusParam = firstParam(params["status"]);
  const status = (CONTACT_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as ContactStatus) : "";
  const page = Math.max(1, Number.parseInt(firstParam(params["page"]), 10) || 1);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  const data = await fetchPageData<Paginated<ContactSummary>>(`/companies/${companyId}/contacts?${query.toString()}`);
  const filtered = Boolean(q || status);

  const filterParams: Record<string, string> = {};
  if (q) filterParams["q"] = q;
  if (status) filterParams["status"] = status;

  return (
    <>
      <PageHeader
        title="Contatos"
        description={`${data.total} ${data.total === 1 ? "contato" : "contatos"}${filtered ? " encontrados" : ""}`}
        actions={
          <Button asChild>
            <Link href="/dashboard/contacts/new">
              <Plus /> Novo contato
            </Link>
          </Button>
        }
      />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Nome, telefone ou e-mail" aria-label="Buscar contatos" maxLength={100} className="pl-9" />
        </div>
        <NativeSelect name="status" defaultValue={status} aria-label="Filtrar por status">
          <NativeSelectOption value="">Todos os status</NativeSelectOption>
          {CONTACT_STATUSES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {CONTACT_STATUS_LABEL[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {filtered ? (
          <Button asChild variant="ghost">
            <Link href="/dashboard/contacts">Limpar</Link>
          </Button>
        ) : null}
      </form>
      <Card className="gap-0 py-0">
        {data.items.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Contact />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "Nenhum contato encontrado" : "Nenhum contato cadastrado"}</EmptyTitle>
              <EmptyDescription>
                {filtered ? "Tente outro termo ou limpe os filtros." : "Cadastre o primeiro contato da sua empresa."}
              </EmptyDescription>
            </EmptyHeader>
            {filtered ? null : (
              <EmptyContent>
                <Button asChild size="sm">
                  <Link href="/dashboard/contacts/new">Novo contato</Link>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Origem</TableHead>
                <TableHead className="hidden pr-5 md:table-cell">Cadastrado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="pl-5">
                    <Link href={`/dashboard/contacts/${contact.id}`} className="font-medium hover:underline">
                      {contact.name}
                    </Link>
                    {contact.email ? <p className="text-xs text-muted-foreground">{contact.email}</p> : null}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{formatPhoneNumber(contact.phone)}</TableCell>
                  <TableCell>
                    <ContactStatusBadge status={contact.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{CONTACT_SOURCE_LABEL[contact.source]}</TableCell>
                  <TableCell className="hidden pr-5 text-muted-foreground md:table-cell">{formatDate(contact.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Pagination basePath="/dashboard/contacts" page={data.page} pageSize={data.pageSize} total={data.total} params={filterParams} />
    </>
  );
}
