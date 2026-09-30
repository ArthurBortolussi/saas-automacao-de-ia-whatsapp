import type { CompanyMemberItem } from "@arthur-ai/shared";
import { Card, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { Users } from "lucide-react";
import { fetchPageData } from "@/lib/api-server";
import { formatDate, MEMBER_ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/format";
import { NewMemberForm } from "./new-member-form";

export default async function CompanyUsersPage({ params }: PageProps<"/admin/companies/[companyId]/users">) {
  const { companyId } = await params;
  const members = await fetchPageData<CompanyMemberItem[]>(`/admin/companies/${encodeURIComponent(companyId)}/members`);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="gap-0 self-start py-0">
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">Usuários da empresa</CardTitle>
        </CardHeader>
        {members.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Nenhum usuário cadastrado</EmptyTitle>
              <EmptyDescription>Crie o primeiro acesso da empresa ao lado.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5">Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="pl-5">
                    <p className="font-medium">{member.user.name}</p>
                    <p className="text-xs text-muted-foreground">{member.user.email}</p>
                  </TableCell>
                  <TableCell>{MEMBER_ROLE_LABEL[member.role]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.user.mustChangePassword ? "Aguardando 1º acesso" : USER_STATUS_LABEL[member.user.status]}
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(member.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <NewMemberForm companyId={companyId} />
    </div>
  );
}
