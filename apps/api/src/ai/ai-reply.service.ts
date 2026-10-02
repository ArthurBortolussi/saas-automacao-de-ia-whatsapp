import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { AiHandoffReason, AiTaskStatus, Company, Prisma } from "@arthur-ai/database";
import { aiMayReply, DEFAULT_HANDOFF_MESSAGE, isServiceWindowOpen, isWithinAiSchedule, MESSAGE_MAX_LENGTH } from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { queuedData } from "../team/conversation-state.js";
import { ConversationEvents } from "../whatsapp/conversation-events.js";
import { WhatsAppOutboundService } from "../whatsapp/whatsapp-outbound.service.js";
import { AiModelClient, type ModelOutcome } from "./ai-model.client.js";
import { AiSettingsService, type ResolvedAiSettings } from "./ai-settings.service.js";
import { KnowledgeService } from "./knowledge.service.js";
import { estimateCostUsd, priceFor } from "./pricing.js";
import {
  BASE_INSTRUCTIONS,
  buildCompanyBlock,
  buildMessages,
  buildNowBlock,
  HANDOFF_TOOL,
  HANDOFF_TOOL_NAME,
  selectKnowledge,
  type HistoryMessage,
} from "./prompt.js";

/** Tipos do WhatsApp com texto que a IA entende. */
const TEXT_TYPES = new Set(["text", "button", "interactive"]);
/** Tipos que não pedem resposta (reação, figurinha, avisos do sistema). */
const SILENT_TYPES = new Set(["reaction", "sticker", "system", "unsupported", "ephemeral", "request_welcome"]);
/** Trechos do prompt interno que nunca podem aparecer numa resposta ao cliente. */
const INTERNAL_MARKERS = ["<base_de_conhecimento", "<orientacoes_da_empresa", "<empresa>", "<assistente>", "<entrada "];

export const AI_MAX_ATTEMPTS = 3;
const retryDelayMs = (attempt: number) => Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));

/** A tarefa deixou de ser válida (ex.: um humano assumiu): nada pode ser enviado. */
class RunInvalidatedError extends Error {}

interface BatchMessage {
  id: string;
  body: string;
  externalType: string | null;
}

interface RunContext {
  runId: string;
  companyId: string;
  conversationId: string;
  attempts: number;
  messages: BatchMessage[];
}

type Decision = { kind: "reply"; text: string } | { kind: "handoff"; reason: AiHandoffReason };

/**
 * Atendimento automático de UM lote (mensagens seguidas do cliente numa conversa).
 * Ordem: checagens baratas (sem chamar o modelo) → contexto só da empresa da conversa → modelo →
 * envio pelo serviço da Fase 3, que confere de novo o modo e a janela de 24h na mesma transação
 * em que marca a tarefa como concluída. Assim não há resposta duplicada nem resposta após o humano assumir.
 */
@Injectable()
export class AiReplyService {
  private readonly logger = new Logger(AiReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly knowledge: KnowledgeService,
    private readonly model: AiModelClient,
    private readonly outbound: WhatsAppOutboundService,
    private readonly audit: AuditService,
    private readonly events: ConversationEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async process(runId: string): Promise<void> {
    const tasks = await this.prisma.aiReplyTask.findMany({
      where: { runId, status: "RUNNING" },
      include: { message: { select: { id: true, body: true, externalType: true } } },
      orderBy: { messageId: "asc" },
    });
    const first = tasks[0];
    if (!first) return;
    const context: RunContext = {
      runId,
      companyId: first.companyId,
      conversationId: first.conversationId,
      attempts: Math.max(...tasks.map((task) => task.attempts)),
      messages: tasks.map((task) => task.message),
    };
    try {
      await this.run(context);
    } catch (error) {
      // Falha nossa (ex.: banco). Só a mensagem do erro: nada de conteúdo de clientes nos logs.
      this.logger.error(`Execução da IA ${runId} falhou: ${error instanceof Error ? error.message : String(error)}`);
      if (context.attempts < AI_MAX_ATTEMPTS) await this.requeue(context, retryDelayMs(context.attempts));
      else await this.finish(context, "FAILED", "INTERNAL_ERROR");
    }
  }

  private async run(context: RunContext): Promise<void> {
    const company = await this.prisma.company.findUnique({ where: { id: context.companyId } });
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: context.conversationId, companyId: context.companyId } },
      select: { mode: true, channel: true, lastInboundAt: true },
    });
    if (!company || !conversation) return this.finish(context, "FAILED", "NOT_FOUND");

    // Checagens antes de gastar com o modelo.
    if (!aiMayReply(conversation.mode)) return this.finish(context, "CANCELED", "MODE_CHANGED");
    if (company.status === "PAUSED" || company.status === "INACTIVE") return this.finish(context, "SKIPPED", "COMPANY_SUSPENDED");
    if (conversation.channel !== "WHATSAPP") return this.finish(context, "SKIPPED", "NOT_WHATSAPP");
    const settings = await this.settings.resolve(company.id);
    if (!settings.enabled) return this.finish(context, "SKIPPED", "AI_DISABLED");
    if (!this.model.configured) return this.finish(context, "SKIPPED", "AI_NOT_CONFIGURED");
    if (!isWithinAiSchedule(settings)) return this.finish(context, "SKIPPED", "OUTSIDE_SCHEDULE");
    if (!isServiceWindowOpen(conversation.lastInboundAt)) return this.finish(context, "SKIPPED", "WINDOW_CLOSED");
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id }, select: { status: true } });
    if (!account || account.status === "DISABLED" || account.status === "ERROR") {
      return this.finish(context, "SKIPPED", "WHATSAPP_UNAVAILABLE");
    }

    const textual = context.messages.filter((message) => message.externalType === null || TEXT_TYPES.has(message.externalType));
    if (textual.length === 0) {
      // Áudio, imagem, documento...: a IA não interpreta. Passa para humano; reação/figurinha não pede resposta.
      const needsHuman = context.messages.some((message) => message.externalType && !SILENT_TYPES.has(message.externalType));
      return needsHuman ? this.handoff(context, company, settings, "UNSUPPORTED_CONTENT", null) : this.finish(context, "SKIPPED", "NO_REPLY_NEEDED");
    }

    // Proteção contra loops (ex.: um robô respondendo a IA): teto de execuções por conversa por hora.
    const recentRuns = await this.prisma.aiRun.count({
      where: { companyId: company.id, conversationId: context.conversationId, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
    });
    if (recentRuns >= this.env.ai.maxRunsPerConversationPerHour) {
      this.logger.warn(`IA: limite de execuções por hora atingido na conversa ${context.conversationId}; passando para humano.`);
      return this.handoff(context, company, settings, "CONVERSATION_LIMIT", null);
    }

    const request = await this.buildRequest(context, company, settings);
    if (!request) return this.finish(context, "SKIPPED", "NO_REPLY_NEEDED");

    const outcome = await this.model.generate(request);
    if (outcome.kind === "error") return this.onModelError(context, company, settings, outcome);

    const decision = interpret(outcome.message);
    const runRowId = await this.recordRun(context, outcome.message, outcome.latencyMs, decision);
    if (decision.kind === "reply") return this.reply(context, company, decision.text, runRowId);
    return this.handoff(context, company, settings, decision.reason, runRowId);
  }

  /** Contexto enviado ao modelo. Tudo filtrado pela empresa E pela conversa do lote. */
  private async buildRequest(context: RunContext, company: Company, settings: ResolvedAiSettings) {
    // Ordem de GRAVAÇÃO (id UUIDv7), não createdAt: o horário das recebidas vem da Meta (em segundos) e o das
    // enviadas do servidor, o que embaralharia mensagens do mesmo segundo. Mensagens que chegaram depois do
    // lote ficam para o próximo.
    const lastId = context.messages.reduce((latest, message) => (message.id > latest ? message.id : latest), "");
    const rows = await this.prisma.message.findMany({
      where: { companyId: company.id, conversationId: context.conversationId, id: { lte: lastId } },
      orderBy: { id: "desc" },
      take: this.env.ai.historyMaxMessages,
      select: { direction: true, senderType: true, body: true, deliveryStatus: true },
    });
    const history: HistoryMessage[] = rows
      .reverse()
      // Mensagem que falhou não chegou ao cliente; mensagens de sistema não são conversa.
      .filter((row) => row.senderType !== "SYSTEM" && !(row.direction === "OUTBOUND" && row.deliveryStatus === "FAILED"))
      .map((row) => ({ role: row.direction === "INBOUND" ? "customer" : row.senderType === "AI" ? "ai" : "agent", body: row.body }));
    const messages = buildMessages(history, this.env.ai.historyMaxChars);
    if (messages.at(-1)?.role !== "user") return null;

    const query = history
      .filter((item) => item.role === "customer")
      .slice(-4)
      .map((item) => item.body)
      .join("\n");
    const knowledge = selectKnowledge(await this.knowledge.activeForAi(company.id), query, this.env.ai.knowledgeMaxChars);
    const system: Anthropic.TextBlockParam[] = [
      // Dois pontos de cache: regras gerais (iguais para todas as empresas) e bloco da empresa.
      { type: "text", text: BASE_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: buildCompanyBlock(company, settings, knowledge.items, knowledge.partial),
        cache_control: { type: "ephemeral" },
      },
      // Volátil: depois dos pontos de cache.
      { type: "text", text: buildNowBlock(new Date(), settings.timezone) },
    ];
    return { system, messages, tools: [HANDOFF_TOOL] };
  }

  private async recordRun(context: RunContext, message: Anthropic.Message, latencyMs: number, decision: Decision): Promise<string> {
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    };
    const id = randomUUID();
    await this.prisma.aiRun.create({
      data: {
        id,
        companyId: context.companyId,
        conversationId: context.conversationId,
        model: message.model.slice(0, 80),
        result: decision.kind === "reply" ? "REPLIED" : "HANDOFF",
        handoffReason: decision.kind === "handoff" ? decision.reason : null,
        stopReason: message.stop_reason?.slice(0, 40) ?? null,
        ...usage,
        costUsd: estimateCostUsd(usage, priceFor(message.model, this.env.ai.model, this.env.ai.priceOverride)),
        latencyMs,
        messageCount: context.messages.length,
      },
    });
    return id;
  }

  private async onModelError(
    context: RunContext,
    company: Company,
    settings: ResolvedAiSettings,
    outcome: Extract<ModelOutcome, { kind: "error" }>,
  ): Promise<void> {
    // Sem consumo informado: tokens e custo ficam nulos (não inventamos números).
    await this.prisma.aiRun.create({
      data: {
        id: randomUUID(),
        companyId: context.companyId,
        conversationId: context.conversationId,
        model: this.env.ai.model,
        result: "ERROR",
        errorType: outcome.errorType,
        latencyMs: outcome.latencyMs,
        messageCount: context.messages.length,
      },
    });
    const status = outcome.status ? ` HTTP ${outcome.status}` : "";
    this.logger.warn(
      `IA: falha na chamada ao modelo (${outcome.errorType}${status}) na conversa ${context.conversationId}, tentativa ${context.attempts}/${AI_MAX_ATTEMPTS}.`,
    );
    if (outcome.retryable && context.attempts < AI_MAX_ATTEMPTS) {
      await this.requeue(context, retryDelayMs(context.attempts));
      return;
    }
    // Erro definitivo (chave inválida, sem créditos...) ou tentativas esgotadas: o cliente não fica sem resposta.
    await this.handoff(context, company, settings, "AI_ERROR", null);
  }

  private async reply(context: RunContext, company: Company, text: string, runRowId: string): Promise<void> {
    try {
      await this.outbound.send(company, context.conversationId, text, {
        type: "AI",
        inTransaction: (tx) => this.completeRun(tx, context.runId, "DONE", "REPLIED"),
      });
    } catch (error) {
      await this.onSendRejected(context, error, runRowId);
    }
  }

  /**
   * Passagem para humano: avisa o cliente (quando o WhatsApp permite) e muda o modo para HUMAN na mesma
   * transação que marca a tarefa. Só acontece uma vez: depois disso a conversa não está mais em modo IA.
   */
  private async handoff(
    context: RunContext,
    company: Company,
    settings: ResolvedAiSettings,
    reason: AiHandoffReason,
    runRowId: string | null,
  ): Promise<void> {
    const transfer = async (tx: Prisma.TransactionClient) => {
      await this.completeRun(tx, context.runId, "DONE", `HANDOFF_${reason}`);
      await this.switchToHuman(tx, context, reason);
    };
    try {
      await this.outbound.send(company, context.conversationId, settings.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE, {
        type: "AI",
        inTransaction: transfer,
      });
      // Fase 5: a conversa entrou na fila humana; o worker da equipe distribui (e avisa o cliente, se preciso).
      this.events.emitHumanQueued(context.companyId);
      return;
    } catch (error) {
      if (!(error instanceof HttpException)) {
        if (error instanceof RunInvalidatedError) return this.discard(runRowId);
        throw error;
      }
    }
    // O WhatsApp não permitiu a mensagem (ex.: janela de 24h fechada): transfere sem avisar.
    try {
      await this.prisma.$transaction(transfer);
    } catch (error) {
      if (error instanceof RunInvalidatedError) return this.discard(runRowId);
      throw error;
    }
    this.events.emitHumanQueued(context.companyId);
  }

  private async switchToHuman(tx: Prisma.TransactionClient, context: RunContext, reason: AiHandoffReason): Promise<void> {
    const { count } = await tx.conversation.updateMany({
      where: { id: context.conversationId, companyId: context.companyId, mode: "AI", status: "OPEN" },
      // Fase 5: além de mudar para HUMAN, entra na fila para a distribuição automática.
      data: { mode: "HUMAN", modeBeforePause: null, aiHandoffReason: reason, aiHandoffAt: new Date(), ...queuedData(new Date()) },
    });
    if (count === 0) return;
    await this.audit.record(
      {
        action: AUDIT_ACTIONS.CONVERSATION_QUEUED,
        actorUserId: null,
        entityType: "Conversation",
        entityId: context.conversationId,
        companyId: context.companyId,
        metadata: { reason: "AI_HANDOFF" },
      },
      tx,
    );
    await this.audit.record(
      {
        action: AUDIT_ACTIONS.CONVERSATION_AI_HANDOFF,
        actorUserId: null,
        entityType: "Conversation",
        entityId: context.conversationId,
        companyId: context.companyId,
        metadata: { reason },
      },
      tx,
    );
  }

  /** Conclui as tarefas do lote. Se não estiverem mais RUNNING (canceladas), aborta a transação do envio. */
  private async completeRun(tx: Prisma.TransactionClient, runId: string, status: AiTaskStatus, outcome: string): Promise<void> {
    const { count } = await tx.aiReplyTask.updateMany({
      where: { runId, status: "RUNNING" },
      data: { status, outcome, lockedUntil: null, finishedAt: new Date() },
    });
    if (count === 0) throw new RunInvalidatedError("Tarefa da IA invalidada antes do envio.");
  }

  private async onSendRejected(context: RunContext, error: unknown, runRowId: string): Promise<void> {
    if (error instanceof RunInvalidatedError) return this.discard(runRowId);
    if (!(error instanceof HttpException)) throw error;
    // Recusado pelas regras do envio (modo mudou, janela fechou, WhatsApp desligado): descarta a resposta.
    await this.discard(runRowId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id_companyId: { id: context.conversationId, companyId: context.companyId } },
      select: { mode: true },
    });
    if (conversation && !aiMayReply(conversation.mode)) await this.finish(context, "CANCELED", "MODE_CHANGED");
    else await this.finish(context, "SKIPPED", "SEND_REJECTED");
  }

  private async discard(runRowId: string | null): Promise<void> {
    if (runRowId) await this.prisma.aiRun.update({ where: { id: runRowId }, data: { result: "DISCARDED" } });
  }

  private async finish(context: RunContext, status: AiTaskStatus, outcome: string): Promise<void> {
    await this.prisma.aiReplyTask.updateMany({
      where: { runId: context.runId, status: "RUNNING" },
      data: { status, outcome, lockedUntil: null, finishedAt: new Date() },
    });
  }

  /** Volta para a fila com espera; `attempts` já foi incrementado na reserva. */
  private async requeue(context: RunContext, delayMs: number): Promise<void> {
    await this.prisma.aiReplyTask.updateMany({
      where: { runId: context.runId, status: "RUNNING" },
      data: { status: "PENDING", runId: null, lockedUntil: null, nextAttemptAt: new Date(Date.now() + delayMs) },
    });
  }
}

const TOOL_REASONS: Record<string, AiHandoffReason> = {
  cliente_pediu: "CUSTOMER_REQUEST",
  sem_informacao: "MISSING_INFORMATION",
};

/** O que fazer com a resposta do modelo. Nada incompleto ou suspeito é enviado ao cliente. */
export function interpret(message: Anthropic.Message): Decision {
  if (message.stop_reason === "refusal") return { kind: "handoff", reason: "MODEL_REFUSAL" };
  const tool = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (tool) {
    if (tool.name !== HANDOFF_TOOL_NAME) return { kind: "handoff", reason: "INCOMPLETE_RESPONSE" };
    const motivo = typeof tool.input === "object" && tool.input !== null && "motivo" in tool.input ? tool.input.motivo : null;
    return { kind: "handoff", reason: (typeof motivo === "string" ? TOOL_REASONS[motivo] : undefined) ?? "MISSING_INFORMATION" };
  }
  if (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence") {
    // max_tokens, contexto excedido, pausa: resposta truncada nunca vai para o cliente.
    return { kind: "handoff", reason: "INCOMPLETE_RESPONSE" };
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text || text.length > MESSAGE_MAX_LENGTH || INTERNAL_MARKERS.some((marker) => text.includes(marker))) {
    return { kind: "handoff", reason: "INCOMPLETE_RESPONSE" };
  }
  return { kind: "reply", text };
}
