import type { TeamResponse } from "@arthur-ai/shared";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TeamManager } from "@/components/team/team-manager";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Equipe" };

export default async function TeamPage() {
  const { companyId } = await requireMembership();
  const team = await fetchPageData<TeamResponse>(`/companies/${companyId}/team`);
  return (
    <>
      <PageHeader
        title="Equipe"
        description={
          team.canManage
            ? "Funcionários, perfis, limites de atendimento e disponibilidade. As conversas humanas são distribuídas automaticamente entre quem está disponível."
            : "Quem está na equipe e a disponibilidade de cada um. Mude a sua no menu lateral."
        }
      />
      <TeamManager companyId={companyId} team={team} inboxHrefPrefix="/dashboard/inbox?assignee=" />
    </>
  );
}
