/**
 * Cores dos gráficos: tokens --chart-* do design system (paleta categórica validada para daltonismo e contraste
 * >= 3:1 sobre o fundo; ordem fixa, nunca reciclada). Índigo = IA, verde-azulado = equipe, âmbar = aguardando.
 * Os números sempre acompanham as cores (legenda com valores e tabela), então a cor nunca é a única pista.
 */
export const SERIES = {
  aiOnly: { color: "var(--chart-1)", label: "Somente IA" },
  withHuman: { color: "var(--chart-2)", label: "Atendimento humano" },
  awaitingHuman: { color: "var(--chart-3)", label: "Aguardando humano" },
  // Categoria residual: cinza neutro, não uma quarta cor.
  other: { color: "var(--chart-muted)", label: "Sem resposta" },
} as const;
