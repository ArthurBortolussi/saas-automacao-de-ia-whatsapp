import { Button } from "@arthur-ai/ui/components/button";
import { FileSpreadsheet, FileText } from "lucide-react";

/**
 * Downloads pela própria API (mesma origem, cookie da sessão). O instante de referência do relatório na tela vai
 * junto: o arquivo traz exatamente o mesmo recorte. A permissão é conferida no backend.
 */
export function ExportButtons({ basePath, period, at }: { basePath: string; period: string; at: string }) {
  const href = (format: "pdf" | "xlsx") => `/api${basePath}/export?${new URLSearchParams({ format, period, at }).toString()}`;
  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={href("pdf")} download>
          <FileText /> PDF
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={href("xlsx")} download>
          <FileSpreadsheet /> Excel
        </a>
      </Button>
    </div>
  );
}
