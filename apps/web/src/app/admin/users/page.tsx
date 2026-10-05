import type { AdminUserItem, Paginated } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Card } from "@arthur-ai/ui/components/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { fetchPageData } from "@/lib/api-server";
import { formatDate, GLOBAL_ROLE_LABEL, MEMBER_ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Usuários" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const raw = (await searchParams)["page"];
  const page = Math.max(1, Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10) || 1);
  const data = await fetchPageData<Paginated<AdminUserItem>>(`/admin/users?page=${page}&pageSize=20`);

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Todos os usuários da plataforma. Novos usuários são criados na página de cada empresa."
      />
      <Card className="gap-0 py-0">
        {data.items.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Nenhum usuário cadastrado</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5">Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.name} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.globalRole === "SUPERADMIN" ? <Badge variant="brand">{GLOBAL_ROLE_LABEL[user.globalRole]}</Badge> : GLOBAL_ROLE_LABEL[user.globalRole]}
                  </TableCell>
                  <TableCell>
                    {user.company ? (
                      <Link href={`/admin/companies/${user.company.id}/users`} className="hover:text-brand-strong hover:underline">
                        {user.company.name}
                        <span className="text-muted-foreground"> · {MEMBER_ROLE_LABEL[user.company.role]}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === "ACTIVE" ? "success" : "neutral"}>{USER_STATUS_LABEL[user.status]}</Badge>
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Pagination basePath="/admin/users" page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
