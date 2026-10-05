import PDFDocument from "pdfkit";
import { formatDurationPt } from "@arthur-ai/shared";
import { formatCount, formatInstant, formatUsdText, type ReportContent, type ReportTable, type ValueKind } from "./report-content.js";

const MARGIN = 48;
// Índigo da marca Vortrix AI (mesmo valor do token --primary do web).
const BRAND = "#4f46e5";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

function display(value: number | string | null, kind: ValueKind | "date", compact = false): string {
  // Nas tabelas (colunas estreitas) "N/D"; nas linhas de indicadores, o texto completo.
  if (value === null) return kind === "duration" ? "Sem dados" : compact ? "N/D" : "Indisponível";
  switch (kind) {
    case "count":
      return formatCount(Number(value));
    case "duration":
      return formatDurationPt(Number(value));
    case "usd":
      return formatUsdText(String(value));
    case "date":
      return String(value).split("-").reverse().join("/");
    case "text":
      return String(value);
  }
}

/** PDF do relatório (fontes padrão do PDF, sem arquivos externos). Gerado em memória e não é gravado em disco. */
export function renderPdf(content: ReportContent): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true,
    info: { Title: `${content.title} — ${content.subject}`, Author: "Vortrix AI", Subject: content.periodLabel },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 20;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  // Cabeçalho
  doc.font("Helvetica-Bold").fontSize(18).fillColor(BRAND).text("Vortrix AI", MARGIN, MARGIN);
  doc.moveDown(0.2).fillColor("#111827").fontSize(15).text(content.title);
  doc.font("Helvetica").fontSize(11).fillColor("#111827").text(content.subject);
  doc.moveDown(0.4).fontSize(9).fillColor(MUTED);
  doc.text(
    `Período: ${content.periodLabel} (${formatInstant(content.from, content.timezone)} a ${formatInstant(content.to, content.timezone)})`,
  );
  doc.text(`Fuso horário: ${content.timezone}`);
  doc.text(`Gerado em: ${formatInstant(content.generatedAt, content.timezone)} · Situação atual em: ${formatInstant(content.currentAsOf, content.timezone)}`);
  doc.moveDown(0.8);

  for (const section of content.sections) {
    ensure(40);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(section.title, MARGIN, doc.y);
    doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + width, doc.y + 2).strokeColor(RULE).stroke();
    doc.moveDown(0.4);
    for (const row of section.rows) {
      ensure(row.note ? 26 : 16);
      const y = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor("#111827").text(row.label, MARGIN, y, { width: width * 0.68 });
      const afterLabel = doc.y;
      doc.font("Helvetica-Bold").text(display(row.value, row.kind), MARGIN + width * 0.68, y, { width: width * 0.32, align: "right" });
      doc.y = Math.max(afterLabel, doc.y);
      if (row.note) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(row.note, MARGIN, doc.y, { width: width * 0.68 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.6);
  }

  for (const table of content.tables) drawTable(doc, table, width, ensure);

  ensure(60);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND).text("Como ler este relatório", MARGIN, doc.y);
  doc.moveDown(0.3);
  for (const note of content.notes) {
    ensure(24);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`• ${note}`, MARGIN, doc.y, { width });
    doc.moveDown(0.2);
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // O rodapé fica dentro da margem inferior: sem zerar a margem, o pdfkit abriria uma página nova para ele.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(`Vortrix AI · ${content.subject} · página ${index + 1} de ${range.count}`, MARGIN, doc.page.height - MARGIN, {
      width,
      align: "center",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}

function drawTable(doc: PDFKit.PDFDocument, table: ReportTable, width: number, ensure: (height: number) => void): void {
  ensure(50);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(table.title, MARGIN, doc.y);
  doc.moveDown(0.3);
  // A primeira coluna de texto (empresa/origem) recebe mais espaço.
  const firstWide = table.columns[0]?.kind === "text";
  const weights = table.columns.map((_, index) => (index === 0 && firstWide ? 2.4 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (width * weight) / total);

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor("#111827");
    const heights = cells.map((cell, index) => doc.heightOfString(cell, { width: (widths[index] ?? 40) - 4 }));
    const height = Math.max(...heights, 10) + 4;
    ensure(height);
    const y = doc.y;
    let x = MARGIN;
    cells.forEach((cell, index) => {
      const columnWidth = widths[index] ?? 40;
      doc.text(cell, x + 2, y + 2, { width: columnWidth - 4, align: index === 0 ? "left" : "right" });
      x += columnWidth;
    });
    doc.moveTo(MARGIN, y + height).lineTo(MARGIN + width, y + height).strokeColor(RULE).stroke();
    doc.y = y + height;
  };

  drawRow(
    table.columns.map((column) => column.short ?? column.header),
    true,
  );
  if (table.rows.length === 0) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Sem dados no período.", MARGIN, doc.y + 4);
  }
  for (const row of table.rows) {
    drawRow(
      row.map((value, index) => display(value, table.columns[index]?.kind ?? "text", true)),
      false,
    );
  }
  doc.moveDown(1);
}
