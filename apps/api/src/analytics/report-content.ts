import {
  AI_USAGE_SOURCE_LABEL,
  type AdminCompanyAnalytics,
  type AiUsageBucket,
  type CompanyAnalyticsReport,
  type CompanyUsageRow,
  type DailyPoint,
  type PlatformAnalyticsReport,
} from "@arthur-ai/shared";

/**
 * Conteúdo das exportações, montado UMA vez a partir do mesmo objeto devolvido pela API. O PDF e o Excel só
 * desenham este conteúdo: os números dos arquivos são, por construção, os mesmos do relatório.
 */

export type ValueKind = "count" | "duration" | "usd" | "text";

export interface ReportRow {
  label: string;
  /** count/duration (segundos)/usd (string decimal)/text; null = sem dados ou indisponível. */
  value: number | string | null;
  kind: ValueKind;
  note?: string;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

export interface ReportTable {
  title: string;
  sheet: string;
  /** `short`: cabeçalho compacto para o PDF (a planilha usa o nome completo). */
  columns: { header: string; kind: ValueKind | "date"; short?: string }[];
  rows: (number | string | null)[][];
}

export interface ReportContent {
  title: string;
  subject: string;
  periodLabel: string;
  timezone: string;
  from: Date;
  to: Date;
  generatedAt: Date;
  currentAsOf: Date;
  sections: ReportSection[];
  tables: ReportTable[];
  notes: string[];
  fileBase: string;
}

type AnyReport = CompanyAnalyticsReport | PlatformAnalyticsReport | AdminCompanyAnalytics;

function operationalSections(report: AnyReport): ReportSection[] {
  const { cycles, closed, current, team } = report;
  return [
    {
      title: "Atendimentos iniciados no período",
      rows: [
        { label: "Atendimentos iniciados", value: cycles.started, kind: "count" },
        { label: "Atendidos somente pela IA (encerrados)", value: cycles.aiOnlyClosed, kind: "count" },
        {
          label: "Somente pela IA, encerrados por inatividade",
          value: cycles.aiOnlyClosedInactivity,
          kind: "count",
          note: "O cliente parou de responder; não indica que o problema foi resolvido.",
        },
        { label: "Atendidos somente pela IA (em andamento)", value: cycles.aiOnlyOpen, kind: "count" },
        { label: "Com atendimento humano", value: cycles.withHuman, kind: "count" },
        { label: "Aguardando atendimento humano", value: cycles.awaitingHuman, kind: "count", note: "Entraram na fila e ainda não foram atendidos por um funcionário." },
        { label: "Sem resposta da IA ou da equipe", value: cycles.withoutResponse, kind: "count" },
        { label: "Transferidos pela IA para humano", value: cycles.aiTransferred, kind: "count" },
      ],
    },
    {
      title: "Encerramentos no período",
      rows: [
        { label: "Atendimentos encerrados", value: closed.total, kind: "count" },
        { label: "Finalizados manualmente", value: closed.manual, kind: "count" },
        { label: "Finalizados por inatividade", value: closed.inactivity, kind: "count" },
      ],
    },
    {
      title: "Situação no momento da geração",
      rows: [
        { label: "Em andamento", value: current.inProgress, kind: "count" },
        { label: "Com a IA", value: current.withAi, kind: "count" },
        { label: "Aguardando na fila", value: current.queued, kind: "count" },
        { label: "Com um funcionário", value: current.withAgent, kind: "count" },
        { label: "Pausados ou sem responsável", value: current.other, kind: "count" },
      ],
    },
    {
      title: "Resultados gerais da equipe",
      rows: [
        { label: "Atendimentos humanos (iniciados no período)", value: team.humanCycles, kind: "count" },
        { label: "Atendimentos humanos encerrados no período", value: team.humanClosed, kind: "count" },
        { label: "Conversas humanas em andamento agora", value: team.humanInProgress, kind: "count" },
        {
          label: "Tempo médio de primeira resposta humana",
          value: team.firstResponse.averageSeconds,
          kind: "duration",
          note: `${team.firstResponse.samples} atendimento(s) medidos`,
        },
        { label: "Pedidos de atendimento humano ainda sem resposta", value: team.withoutHumanReply, kind: "count" },
        {
          label: "Tempo médio de espera na fila",
          value: team.queueWait.averageSeconds,
          kind: "duration",
          note: `${team.queueWait.samples} atendimento(s) medidos`,
        },
      ],
    },
  ];
}

function dailyTable(daily: DailyPoint[]): ReportTable {
  return {
    title: "Evolução diária",
    sheet: "Diário",
    columns: [
      { header: "Dia", kind: "date" },
      { header: "Iniciados", kind: "count" },
      { header: "Somente IA", kind: "count" },
      { header: "Com atendimento humano", kind: "count" },
      { header: "Encerrados", kind: "count" },
    ],
    rows: daily.map((day) => [day.date, day.started, day.aiOnly, day.withHuman, day.closed]),
  };
}

function usageSection(buckets: AiUsageBucket[]): { section: ReportSection; table: ReportTable } {
  const official = buckets.find((bucket) => bucket.source === "OFFICIAL");
  const rows: ReportRow[] = [
    { label: "Execuções da IA (todas as origens)", value: buckets.reduce((sum, bucket) => sum + bucket.runs, 0), kind: "count" },
    { label: "Custo estimado — API oficial (USD)", value: official?.estimatedCostUsd ?? "0.000000", kind: "usd" },
    {
      label: "Custo médio por atendimento com IA — API oficial (USD)",
      value: official?.averageCostPerCycleUsd ?? null,
      kind: "usd",
      note: official?.averageCostPerCycleUsd ? `${official.cyclesWithCost} atendimento(s)` : "Indisponível: sem execuções oficiais com custo no período.",
    },
  ];
  for (const bucket of buckets) {
    if (bucket.source === "OFFICIAL" || bucket.runs === 0) continue;
    rows.push({
      label: `Custo estimado — ${AI_USAGE_SOURCE_LABEL[bucket.source]} (USD)`,
      value: bucket.estimatedCostUsd,
      kind: "usd",
      note: "Não é despesa real da plataforma.",
    });
  }
  return {
    section: { title: "Consumo da IA (estimativa)", rows },
    table: {
      title: "Consumo da IA por origem",
      sheet: "Consumo IA",
      columns: [
        { header: "Origem", kind: "text" },
        { header: "Execuções", kind: "count", short: "Exec." },
        { header: "Tokens de entrada", kind: "count", short: "Entrada" },
        { header: "Tokens de saída", kind: "count", short: "Saída" },
        { header: "Tokens de cache (escrita)", kind: "count", short: "Cache escr." },
        { header: "Tokens de cache (leitura)", kind: "count", short: "Cache leit." },
        { header: "Custo estimado (USD)", kind: "usd", short: "Custo" },
        { header: "Execuções sem custo", kind: "count", short: "Sem custo" },
        { header: "Atendimentos com custo", kind: "count", short: "Atend." },
        { header: "Custo médio por atendimento (USD)", kind: "usd", short: "Média/atend." },
      ],
      rows: buckets.map((bucket) => [
        AI_USAGE_SOURCE_LABEL[bucket.source],
        bucket.runs,
        bucket.inputTokens,
        bucket.outputTokens,
        bucket.cacheCreationInputTokens,
        bucket.cacheReadInputTokens,
        bucket.estimatedCostUsd,
        bucket.runsWithoutCost,
        bucket.cyclesWithCost,
        bucket.averageCostPerCycleUsd,
      ]),
    },
  };
}

function companiesTable(rows: CompanyUsageRow[]): ReportTable {
  return {
    title: "Resumo por empresa",
    sheet: "Por empresa",
    columns: [
      { header: "Empresa", kind: "text" },
      { header: "Atendimentos iniciados", kind: "count" },
      { header: "Execuções da IA", kind: "count" },
      { header: "Tokens", kind: "count" },
      { header: "Custo estimado oficial (USD)", kind: "usd" },
      { header: "Custo simulado ou não verificado (USD)", kind: "usd" },
    ],
    rows: rows.map((row) => [row.name, row.cyclesStarted, row.aiRuns, row.totalTokens, row.costOfficialUsd, row.costNotOfficialUsd]),
  };
}

const COMMON_NOTES = [
  "Atendimento = ciclo de uma conversa, da criação ou reabertura até o encerramento. Uma conversa reaberta gera um novo atendimento.",
  "Os atendimentos do período são os iniciados no período, classificados pelo que aconteceu até o instante de referência.",
  "\"Somente pela IA\" significa que não houve transferência nem participação de funcionário; não comprova que o problema do cliente foi resolvido.",
  "Primeira resposta humana: do pedido de atendimento humano (entrada na fila ou atribuição) até a primeira mensagem de um funcionário. Respostas da IA e avisos automáticos não contam.",
  "Espera na fila: soma das esperas concluídas por atribuição a um funcionário em cada atendimento; esperas em andamento não entram na média.",
];

function reconstructedNote(count: number): string[] {
  return count > 0
    ? [`${count} atendimento(s) do período foram reconstruídos de dados anteriores ao Analytics: entram nas contagens, mas não nas médias de tempo.`]
    : [];
}

/** Nome de arquivo seguro (ASCII, sem caracteres de cabeçalho). */
function fileSlug(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "empresa";
}

function base(report: AnyReport, title: string, subject: string) {
  return {
    title,
    subject,
    periodLabel: report.period.label,
    timezone: report.period.timezone,
    from: new Date(report.period.from),
    to: new Date(report.period.to),
    generatedAt: new Date(report.generatedAt),
    currentAsOf: new Date(report.current.asOf),
  };
}

export function companyContent(report: CompanyAnalyticsReport): ReportContent {
  return {
    ...base(report, "Relatório de atendimento", report.company.name),
    sections: operationalSections(report),
    tables: [dailyTable(report.daily)],
    notes: [...COMMON_NOTES, ...reconstructedNote(report.cycles.reconstructed)],
    fileBase: `analytics-${fileSlug(report.company.name)}-${report.period.period}-${report.generatedAt.slice(0, 10)}`,
  };
}

const COST_NOTES = [
  "Custos em dólares americanos (USD), estimados pela tabela de preços configurada no momento de cada execução. A fatura oficial é a da Anthropic.",
  "O custo estimado da IA não é o custo operacional completo da plataforma (infraestrutura, WhatsApp e equipe não estão incluídos).",
  "Execuções no simulador não são despesa real. Execuções anteriores ao Analytics não registram a origem e aparecem como \"origem não verificada\".",
  "N/D nas tabelas = indisponível (sem base de cálculo confiável no período).",
];

export function platformContent(report: PlatformAnalyticsReport): ReportContent {
  const usage = usageSection(report.ai.bySource);
  const { messages } = report;
  return {
    ...base(report, "Relatório consolidado da plataforma", "Vortrix AI — todas as empresas"),
    sections: [
      {
        title: "Empresas",
        rows: [
          { label: "Empresas cadastradas", value: report.companies.total, kind: "count" },
          { label: "Empresas com atividade no período", value: report.companies.withActivity, kind: "count" },
        ],
      },
      ...operationalSections(report),
      {
        title: "Mensagens no período",
        rows: [
          { label: "Recebidas", value: messages.inbound, kind: "count" },
          { label: "Enviadas pela IA", value: messages.outboundAi, kind: "count" },
          { label: "Enviadas pela equipe", value: messages.outboundAgent, kind: "count" },
          { label: "Avisos automáticos do sistema", value: messages.outboundSystem, kind: "count" },
          { label: "Envios com falha (incluídos acima)", value: messages.outboundFailed, kind: "count" },
        ],
      },
      usage.section,
    ],
    tables: [dailyTable(report.daily), usage.table, companiesTable(report.byCompany)],
    notes: [...COMMON_NOTES, ...reconstructedNote(report.cycles.reconstructed), ...COST_NOTES],
    fileBase: `analytics-plataforma-${report.period.period}-${report.generatedAt.slice(0, 10)}`,
  };
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatUsdText(value: string): string {
  return `US$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}

export function formatInstant(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(date);
}
