import type { TeamResponse } from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { TeamManager } from "@/components/team/team-manager";
import { fetchPageData } from "@/lib/api-server";

/** Supervisão: o Superadmin acompanha a equipe; a administração cotidiana é do responsável da empresa. */
export default async function CompanyTeamPage({ params }: PageProps<"/admin/companies/[companyId]/team">) {
  const { companyId } = await params;
  const team = await fetchPageData<TeamResponse>(`/companies/${encodeURIComponent(companyId)}/team`);
  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          Somente consulta: o cadastro, os perfis, os limites e as transferências são feitos pelo proprietário ou administrador da empresa. O
          acesso técnico de criação de usuários continua na aba Usuários.
        </AlertDescription>
      </Alert>
      <TeamManager companyId={companyId} team={team} inboxHrefPrefix={null} />
    </div>
  );
}
