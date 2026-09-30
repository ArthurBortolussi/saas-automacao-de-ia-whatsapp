import type { CompanySummary } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { CompanyStatusBadge } from "@/components/status-badge";
import { formatDate, formatLocation } from "@/lib/format";

export function CompaniesTable({ companies, emptyMessage }: { companies: CompanySummary[]; emptyMessage?: string }) {
  if (companies.length === 0) {
    return (
      <Empty className="py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>{emptyMessage ?? "Nenhuma empresa cadastrada"}</EmptyTitle>
          <EmptyDescription>As empresas cadastradas aparecem aqui.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Empresa</TableHead>
          <TableHead>Segmento</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cidade/Estado</TableHead>
          <TableHead>Criada em</TableHead>
          <TableHead className="pr-5 text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {companies.map((company) => (
          <TableRow key={company.id}>
            <TableCell className="pl-5">
              <Link href={`/admin/companies/${company.id}`} className="font-medium hover:underline">
                {company.name}
              </Link>
              <p className="text-xs text-muted-foreground">{company.slug}</p>
            </TableCell>
            <TableCell className="text-muted-foreground">{company.industry}</TableCell>
            <TableCell>
              <CompanyStatusBadge status={company.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{formatLocation(company.city, company.state)}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(company.createdAt)}</TableCell>
            <TableCell className="pr-5 text-right">
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/companies/${company.id}`}>Abrir</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
