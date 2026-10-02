import writeXlsxFile, { type Cell, type Row, type Sheet } from "write-excel-file/node";
import { formatInstant, type ReportContent, type ValueKind } from "./report-content.js";

const COUNT_FORMAT = "#,##0";
// Duração em fração de dia (padrão do Excel): horas acumuladas, minutos e segundos.
const DURATION_FORMAT = "[h]:mm:ss";
const USD_FORMAT = '"US$" #,##0.000000';
const DATE_FORMAT = "dd/mm/yyyy";

function cell(value: number | string | null, kind: ValueKind | "date"): Cell {
  if (value === null) return { value: kind === "duration" ? "Sem dados" : "Indisponível", type: String };
  switch (kind) {
    case "count":
      return { value: Number(value), type: Number, format: COUNT_FORMAT };
    case "duration":
      return { value: Number(value) / 86_400, type: Number, format: DURATION_FORMAT };
    case "usd":
      return { value: Number(value), type: Number, format: USD_FORMAT };
    case "date":
      // Data pura do calendário do relatório (meia-noite UTC = o mesmo dia no Excel, que não tem fuso).
      return { value: new Date(`${String(value)}T00:00:00Z`), type: Date, format: DATE_FORMAT };
    case "text":
      return { value: String(value), type: String };
  }
}

const header = (text: string): Cell => ({ value: text, type: String, fontWeight: "bold" });
const text = (value: string): Cell => ({ value, type: String });

/** Planilha do relatório: resumo, uma aba por tabela e as notas. Gerada em memória, nunca gravada em disco. */
export async function renderXlsx(content: ReportContent): Promise<Buffer> {
  const tz = content.timezone;
  const summary: Row[] = [
    [{ value: `${content.title} — ${content.subject}`, type: String, fontWeight: "bold" }],
    [text("Período"), text(content.periodLabel)],
    [text("Início"), text(formatInstant(content.from, tz))],
    [text("Fim (instante de referência)"), text(formatInstant(content.to, tz))],
    [text("Fuso horário"), text(tz)],
    [text("Gerado em"), text(formatInstant(content.generatedAt, tz))],
    [text("Situação atual em"), text(formatInstant(content.currentAsOf, tz))],
    [],
    [header("Seção"), header("Indicador"), header("Valor"), header("Observação")],
  ];
  for (const section of content.sections) {
    for (const row of section.rows) {
      summary.push([text(section.title), text(row.label), cell(row.value, row.kind), text(row.note ?? "")]);
    }
  }

  const sheets: Sheet<Buffer>[] = [{ sheet: "Resumo", data: summary, columns: [{ width: 34 }, { width: 52 }, { width: 18 }, { width: 50 }] }];
  for (const table of content.tables) {
    sheets.push({
      sheet: table.sheet,
      data: [
        table.columns.map((column) => header(column.header)),
        ...table.rows.map((row) => row.map((value, index) => cell(value, table.columns[index]?.kind ?? "text"))),
      ],
      columns: table.columns.map((column) => ({ width: column.kind === "text" ? 36 : 18 })),
      stickyRowsCount: 1,
    });
  }
  sheets.push({ sheet: "Notas", data: content.notes.map((note) => [text(note)]), columns: [{ width: 140 }] });

  return writeXlsxFile(sheets).toBuffer();
}
