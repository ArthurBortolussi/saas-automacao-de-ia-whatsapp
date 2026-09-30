import { Button } from "@arthur-ai/ui/components/button";
import Link from "next/link";

interface PaginationProps {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  params?: Record<string, string>;
}

export function Pagination({ basePath, page, pageSize, total, params = {} }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(target) }).toString()}`;

  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-muted-foreground" aria-label="Paginação">
      <span>
        Página {page} de {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Anterior</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Anterior
          </Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Próxima</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Próxima
          </Button>
        )}
      </div>
    </nav>
  );
}
