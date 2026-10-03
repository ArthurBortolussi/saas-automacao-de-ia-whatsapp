import type { AiLimitAlertRow } from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import Link from "next/link";
import { AI_USAGE_LEVEL_LABEL, formatUsd } from "@/lib/format";

/** Empresas com consumo da IA em 80% ou mais do limite do mês. */
export function AiLimitAlerts({ rows }: { rows: AiLimitAlertRow[] }) {
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-muted-foreground">Nenhuma empresa perto do limite mensal da IA.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Empresa</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead className="text-right">Gasto / limite</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.companyId}>
            <TableCell>
              <Link href={`/admin/companies/${row.companyId}/ai`} className="font-medium underline-offset-4 hover:underline">
                {row.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={row.level === "LIMIT_REACHED" ? "destructive" : "secondary"}>{AI_USAGE_LEVEL_LABEL[row.level]}</Badge>
              {row.source === "SIMULATED" ? <span className="ml-2 text-xs text-muted-foreground">(simulado)</span> : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatUsd(row.spentUsd)} / {formatUsd(row.limitUsd)} · {row.percent}%
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
