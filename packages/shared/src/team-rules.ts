/** Texto operacional fixo (não gerado pela IA) enviado uma vez a cada entrada na fila. */
export const QUEUE_WAITING_MESSAGE =
  "No momento, todos os nossos atendentes estão ocupados. Sua solicitação já está na fila e será encaminhada assim que um atendente estiver disponível.";

export const DEFAULT_MAX_CONCURRENT = 5;
export const MAX_CONCURRENT_LIMIT = 100;
export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 240;
export const MIN_INACTIVITY_TIMEOUT_MINUTES = 5;
export const MAX_INACTIVITY_TIMEOUT_MINUTES = 43_200;
