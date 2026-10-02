/**
 * Cores dos gráficos (paleta categórica validada para daltonismo: ordem fixa, nunca reciclada).
 * O verde-água tem contraste < 3:1 com o fundo: sempre acompanhado de legenda com números e da tabela.
 */
export const SERIES = {
  aiOnly: { color: "#2a78d6", label: "Somente IA" },
  withHuman: { color: "#eb6834", label: "Atendimento humano" },
  awaitingHuman: { color: "#1baf7a", label: "Aguardando humano" },
  // Categoria residual: cinza neutro, não uma quarta cor.
  other: { color: "#b8b7b0", label: "Sem resposta" },
} as const;
