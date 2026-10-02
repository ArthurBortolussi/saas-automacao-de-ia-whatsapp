import { KNOWLEDGE_STATUS_FILTERS, type KnowledgeStatusFilter } from "@arthur-ai/shared";

const PAGE_SIZE = 20;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Lê busca/filtro/página da URL e monta a query da API (a API valida de novo). */
export function knowledgeQuery(params: Record<string, string | string[] | undefined>) {
  const q = firstParam(params["q"]).slice(0, 100);
  const statusParam = firstParam(params["status"]);
  const status: KnowledgeStatusFilter = (KNOWLEDGE_STATUS_FILTERS as readonly string[]).includes(statusParam)
    ? (statusParam as KnowledgeStatusFilter)
    : "all";
  const page = Math.max(1, Number.parseInt(firstParam(params["page"]), 10) || 1);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
  if (q) query.set("q", q);
  return { q, status, query: query.toString() };
}
