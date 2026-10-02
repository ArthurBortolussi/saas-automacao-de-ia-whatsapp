import type { KnowledgeListResponse } from "@arthur-ai/shared";
import { KnowledgeBaseManager } from "@/components/ai/knowledge-base-manager";
import { fetchPageData } from "@/lib/api-server";
import { knowledgeQuery } from "@/lib/knowledge-query";

export default async function CompanyKnowledgePage({ params, searchParams }: PageProps<"/admin/companies/[companyId]/knowledge-base">) {
  const { companyId } = await params;
  const { q, status, query } = knowledgeQuery(await searchParams);
  const id = encodeURIComponent(companyId);
  const data = await fetchPageData<KnowledgeListResponse>(`/companies/${id}/knowledge-base?${query}`);
  return <KnowledgeBaseManager companyId={companyId} basePath={`/admin/companies/${id}/knowledge-base`} data={data} q={q} status={status} />;
}
