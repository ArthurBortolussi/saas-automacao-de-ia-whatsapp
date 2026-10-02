import type { KnowledgeListResponse } from "@arthur-ai/shared";
import type { Metadata } from "next";
import { KnowledgeBaseManager } from "@/components/ai/knowledge-base-manager";
import { PageHeader } from "@/components/page-header";
import { fetchPageData, requireMembership } from "@/lib/api-server";
import { knowledgeQuery } from "@/lib/knowledge-query";

export const metadata: Metadata = { title: "Base de conhecimento" };

export default async function KnowledgePage({ searchParams }: PageProps<"/dashboard/knowledge-base">) {
  const { companyId } = await requireMembership();
  const { q, status, query } = knowledgeQuery(await searchParams);
  const data = await fetchPageData<KnowledgeListResponse>(`/companies/${companyId}/knowledge-base?${query}`);
  return (
    <>
      <PageHeader
        title="Base de conhecimento"
        description="Informações da empresa que o assistente usa para responder. Só as ativas são usadas pela IA."
      />
      <KnowledgeBaseManager companyId={companyId} basePath="/dashboard/knowledge-base" data={data} q={q} status={status} />
    </>
  );
}
