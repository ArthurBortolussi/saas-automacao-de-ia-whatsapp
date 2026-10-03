import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "./cnpj.js";
import { ANALYTICS_PERIODS, DEFAULT_ANALYTICS_PERIOD } from "./analytics.js";
import { AI_TIME_PATTERN, isValidTimeZone, KNOWLEDGE_CONTENT_MAX, KNOWLEDGE_TITLE_MAX } from "./ai-rules.js";
import { CONVERSATION_ACTIONS } from "./conversation-rules.js";
import {
  AGENT_AVAILABILITIES,
  AI_TONES,
  BRAZILIAN_STATES,
  type ConversationMode,
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  MEMBER_ROLES,
  SCHEDULE_OVERRIDES,
  SETTINGS_PERMISSIONS,
} from "./enums.js";
import { AUTO_MESSAGE_MAX_LENGTH, HOLIDAY_YEAR_MAX, HOLIDAY_YEAR_MIN, isValidDate, MAX_QUEUE_WAIT_LIMIT_MINUTES } from "./schedule-rules.js";
import { normalizePhone } from "./phone.js";
import {
  DEFAULT_MAX_CONCURRENT,
  MAX_CONCURRENT_LIMIT,
  MAX_INACTIVITY_TIMEOUT_MINUTES,
  MIN_INACTIVITY_TIMEOUT_MINUTES,
} from "./team-rules.js";

// Mensagens padrão do Zod em português (usadas quando o schema não define mensagem própria).
z.config(z.locales.ptBR());

export const PASSWORD_MIN_LENGTH = 10;
// Teto evita DoS com senhas gigantes no hash.
export const PASSWORD_MAX_LENGTH = 128;

// Rejeita campos desconhecidos com mensagem clara.
function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? `Campo não permitido: ${issue.keys.join(", ")}.` : undefined),
  });
}

// Formulários enviam "" para campos opcionais vazios; tratamos como ausente.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );
}

export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail muito longo.")
  .pipe(z.email("E-mail inválido."));

export const newPasswordSchema = z
  .string({ error: "Informe a senha." })
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);

export const loginSchema = strictObject({
  email: emailSchema,
  password: z.string({ error: "Informe a senha." }).min(1, "Informe a senha.").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = strictObject({
    currentPassword: z.string({ error: "Informe a senha atual." }).min(1, "Informe a senha atual.").max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "A nova senha deve ser diferente da atual.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Informe ${label}.` })
    .trim()
    .min(1, { error: `Informe ${label}.`, abort: true })
    .min(min, `Mínimo de ${min} caracteres.`)
    .max(max, `Máximo de ${max} caracteres.`);

export const createCompanySchema = strictObject({
  name: text("o nome", 2, 120),
  legalName: optional(text("a razão social", 2, 200)),
  industry: text("o segmento", 2, 80),
  cnpj: optional(
    z
      .string()
      .trim()
      .refine(isValidCnpj, "CNPJ inválido.")
      .transform(normalizeCnpj),
  ),
  phone: z
    .string({ error: "Informe o telefone." })
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().regex(/^\d{10,13}$/, "Telefone inválido. Use DDD + número.")),
  email: optional(emailSchema),
  website: optional(
    z
      .string()
      .trim()
      .max(255, "Máximo de 255 caracteres.")
      .pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.domain, error: "Site inválido. Use http(s)://dominio." })),
  ),
  address: optional(text("o endereço", 2, 200)),
  city: optional(text("a cidade", 2, 80)),
  state: optional(z.enum(BRAZILIAN_STATES, { error: "UF inválida." })),
  businessHours: optional(text("o horário de funcionamento", 2, 200)),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateCompanyData = z.output<typeof createCompanySchema>;

export const createCompanyMemberSchema = strictObject({
  name: text("o nome", 2, 120),
  email: emailSchema,
  password: newPasswordSchema,
  role: z.enum(MEMBER_ROLES, { error: "Role inválida." }),
});
export type CreateCompanyMemberInput = z.infer<typeof createCompanyMemberSchema>;

export const COMPANY_LIST_MAX_PAGE_SIZE = 50;

export const listCompaniesQuerySchema = strictObject({
  q: optional(z.string().trim().max(100, "Busca muito longa.")),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(COMPANY_LIST_MAX_PAGE_SIZE).default(20),
});
export type ListCompaniesQuery = z.output<typeof listCompaniesQuerySchema>;

export const listUsersQuerySchema = strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(COMPANY_LIST_MAX_PAGE_SIZE).default(20),
});
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

// ---------------------------------------------------------------- FASE 2

export const uuidSchema = z.uuid("Identificador inválido.");

export const CONTACT_LIST_MAX_PAGE_SIZE = 50;
export const MESSAGE_MAX_LENGTH = 4000;

const phoneSchema = z
  .string({ error: "Informe o telefone." })
  .trim()
  .max(30, "Telefone inválido.")
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Telefone inválido. Use DDD + número, ou DDI + DDD + número." });
      return z.NEVER;
    }
    return phone;
  });

const contactFields = {
  name: text("o nome", 2, 120),
  phone: phoneSchema,
  email: optional(emailSchema),
  status: z.enum(CONTACT_STATUSES, { error: "Status inválido." }),
  source: z.enum(CONTACT_SOURCES, { error: "Origem inválida." }),
  notes: optional(z.string().trim().max(2000, "Máximo de 2000 caracteres.")),
};

export const createContactSchema = strictObject({
  ...contactFields,
  status: contactFields.status.default("NEW"),
  source: contactFields.source.default("MANUAL"),
});
export type CreateContactInput = z.input<typeof createContactSchema>;
export type CreateContactData = z.output<typeof createContactSchema>;

/**
 * Edição parcial. Em campos opcionais, null limpa o valor; ausente mantém.
 * (string vazia vinda de formulário também limpa.)
 */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullable().optional());

export const updateContactSchema = strictObject({
  name: contactFields.name.optional(),
  phone: phoneSchema.optional(),
  email: clearable(emailSchema),
  status: contactFields.status.optional(),
  source: contactFields.source.optional(),
  notes: clearable(z.string().trim().max(2000, "Máximo de 2000 caracteres.")),
}).refine((data) => Object.keys(data).length > 0, {
  message: "Nada para atualizar.",
});
export type UpdateContactInput = z.input<typeof updateContactSchema>;
export type UpdateContactData = z.output<typeof updateContactSchema>;

const pageFields = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CONTACT_LIST_MAX_PAGE_SIZE).default(20),
};

export const listContactsQuerySchema = strictObject({
  q: optional(z.string().trim().max(100, "Busca muito longa.")),
  status: optional(z.enum(CONTACT_STATUSES, { error: "Status inválido." })),
  ...pageFields,
});
export type ListContactsQuery = z.output<typeof listContactsQuerySchema>;

// Fase 5: mine (atribuídas a mim), queued (na fila), unassigned (humanas sem responsável), closed (encerradas).
export const INBOX_FILTERS = ["all", "ai", "human", "paused", "unread", "mine", "queued", "unassigned", "closed"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const listConversationsQuerySchema = strictObject({
  filter: z.enum(INBOX_FILTERS, { error: "Filtro inválido." }).default("all"),
  contactId: optional(uuidSchema),
  // Fase 5: atendimentos atribuídos a um funcionário (o filtro é sempre dentro da empresa da rota).
  assigneeId: optional(uuidSchema),
  ...pageFields,
});
export type ListConversationsQuery = z.output<typeof listConversationsQuerySchema>;

export const createConversationSchema = strictObject({
  contactId: uuidSchema,
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = strictObject({
  body: z
    .string({ error: "Escreva a mensagem." })
    .trim()
    .min(1, "Escreva a mensagem.")
    .max(MESSAGE_MAX_LENGTH, `Máximo de ${MESSAGE_MAX_LENGTH} caracteres.`),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = strictObject({
  // Cursor: id da mensagem mais antiga já carregada; devolve as anteriores a ela.
  before: optional(uuidSchema),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.output<typeof listMessagesQuerySchema>;

export const conversationActionSchema = strictObject({
  action: z.enum(CONVERSATION_ACTIONS, { error: "Ação inválida." }),
});
export type ConversationActionInput = z.infer<typeof conversationActionSchema>;


// ---------------------------------------------------------------- FASE 3

const metaId = (label: string) =>
  z
    .string({ error: `Informe o ${label}.` })
    .trim()
    .regex(/^\d{5,32}$/, `${label} inválido: use apenas os dígitos fornecidos pela Meta.`);

// Tokens da Meta são longos e sem espaços; não validamos o formato interno (opaco).
const accessTokenSchema = z
  .string({ error: "Informe o token de acesso." })
  .trim()
  .min(20, "Token de acesso muito curto.")
  .max(2048, "Token de acesso muito longo.")
  .regex(/^\S+$/, "O token não pode conter espaços.");

const whatsappFields = {
  wabaId: metaId("WABA ID"),
  phoneNumberId: metaId("Phone Number ID"),
  displayPhoneNumber: z
    .string({ error: "Informe o número." })
    .trim()
    .min(8, "Número inválido.")
    .max(32, "Número inválido.")
    .regex(/^\+?[\d\s()-]+$/, "Número inválido."),
  verifiedName: optional(text("o nome de exibição", 2, 120)),
};

export const createWhatsAppAccountSchema = strictObject({ ...whatsappFields, accessToken: accessTokenSchema });
export type CreateWhatsAppAccountInput = z.input<typeof createWhatsAppAccountSchema>;
export type CreateWhatsAppAccountData = z.output<typeof createWhatsAppAccountSchema>;

/** Atualização: token vazio/ausente mantém o atual (ele nunca é devolvido ao navegador). */
export const updateWhatsAppAccountSchema = strictObject({
  ...whatsappFields,
  accessToken: optional(accessTokenSchema),
});
export type UpdateWhatsAppAccountInput = z.input<typeof updateWhatsAppAccountSchema>;
export type UpdateWhatsAppAccountData = z.output<typeof updateWhatsAppAccountSchema>;

export const WHATSAPP_ACCOUNT_ACTIONS = ["DISABLE", "ENABLE", "TEST"] as const;
export const whatsappAccountActionSchema = strictObject({
  action: z.enum(WHATSAPP_ACCOUNT_ACTIONS, { error: "Ação inválida." }),
});
export type WhatsAppAccountAction = (typeof WHATSAPP_ACCOUNT_ACTIONS)[number];

// ---------------------------------------------------------------- FASE 4

const knowledgeFields = {
  title: text("o título", 2, KNOWLEDGE_TITLE_MAX),
  content: text("o conteúdo", 2, KNOWLEDGE_CONTENT_MAX),
  category: z.string().trim().max(60, "Máximo de 60 caracteres."),
  active: z.boolean({ error: "Valor inválido." }),
  position: z.number({ error: "Ordem inválida." }).int("Ordem inválida.").min(0, "Ordem inválida.").max(100_000, "Ordem inválida."),
};

export const createKnowledgeEntrySchema = strictObject({
  title: knowledgeFields.title,
  content: knowledgeFields.content,
  category: optional(knowledgeFields.category),
  active: knowledgeFields.active.default(true),
  position: knowledgeFields.position.default(0),
});
export type CreateKnowledgeEntryInput = z.input<typeof createKnowledgeEntrySchema>;
export type CreateKnowledgeEntryData = z.output<typeof createKnowledgeEntrySchema>;

export const updateKnowledgeEntrySchema = strictObject({
  title: knowledgeFields.title.optional(),
  content: knowledgeFields.content.optional(),
  category: clearable(knowledgeFields.category),
  active: knowledgeFields.active.optional(),
  position: knowledgeFields.position.optional(),
}).refine((data) => Object.keys(data).length > 0, { message: "Nada para atualizar." });
export type UpdateKnowledgeEntryInput = z.input<typeof updateKnowledgeEntrySchema>;
export type UpdateKnowledgeEntryData = z.output<typeof updateKnowledgeEntrySchema>;

export const KNOWLEDGE_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type KnowledgeStatusFilter = (typeof KNOWLEDGE_STATUS_FILTERS)[number];

export const listKnowledgeQuerySchema = strictObject({
  q: optional(z.string().trim().max(100, "Busca muito longa.")),
  status: z.enum(KNOWLEDGE_STATUS_FILTERS, { error: "Filtro inválido." }).default("all"),
  ...pageFields,
});
export type ListKnowledgeQuery = z.output<typeof listKnowledgeQuerySchema>;

export const DEFAULT_CONVERSATION_MODES = ["AI", "HUMAN"] as const satisfies readonly ConversationMode[];

const timeSchema = z.string({ error: "Informe o horário." }).regex(AI_TIME_PATTERN, "Use o formato HH:MM (ex.: 08:00).");

/** Campos que o proprietário/administrador da empresa pode editar (o SUPERADMIN também). */
const aiCompanyFields = {
  assistantName: text("o nome do assistente", 2, 60),
  tone: z.enum(AI_TONES, { error: "Tom inválido." }),
  instructions: clearable(z.string().trim().max(4000, "Máximo de 4000 caracteres.")),
  handoffMessage: clearable(z.string().trim().max(1000, "Máximo de 1000 caracteres.")),
  alwaysOn: z.boolean({ error: "Valor inválido." }),
  timezone: z
    .string({ error: "Informe o fuso horário." })
    .trim()
    .min(1, "Informe o fuso horário.")
    .max(64, "Fuso horário inválido.")
    .refine(isValidTimeZone, "Fuso horário inválido (use o formato IANA, ex.: America/Sao_Paulo)."),
  scheduleDays: z
    .array(z.number().int().min(0).max(6), { error: "Dias inválidos." })
    .min(1, "Escolha ao menos um dia.")
    .max(7, "Dias inválidos.")
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  scheduleStart: timeSchema,
  scheduleEnd: timeSchema,
  // Mesmos limites do prazo da equipe (5 minutos a 30 dias).
  inactivityTimeoutMinutes: z
    .number({ error: "Informe o tempo." })
    .int("Use minutos inteiros.")
    .min(MIN_INACTIVITY_TIMEOUT_MINUTES, `Mínimo de ${MIN_INACTIVITY_TIMEOUT_MINUTES} minutos.`)
    .max(MAX_INACTIVITY_TIMEOUT_MINUTES, "Máximo de 30 dias."),
};

const companyAiShape = {
  assistantName: aiCompanyFields.assistantName.optional(),
  tone: aiCompanyFields.tone.optional(),
  instructions: aiCompanyFields.instructions,
  handoffMessage: aiCompanyFields.handoffMessage,
  alwaysOn: aiCompanyFields.alwaysOn.optional(),
  timezone: aiCompanyFields.timezone.optional(),
  scheduleDays: aiCompanyFields.scheduleDays.optional(),
  scheduleStart: aiCompanyFields.scheduleStart.optional(),
  scheduleEnd: aiCompanyFields.scheduleEnd.optional(),
  inactivityTimeoutMinutes: aiCompanyFields.inactivityTimeoutMinutes.optional(),
};

const nonEmpty = { message: "Nada para atualizar." };

/** Rota da empresa: campos técnicos (ligar a IA, modo padrão) são rejeitados como desconhecidos. */
export const updateCompanyAiSettingsSchema = strictObject(companyAiShape).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateCompanyAiSettingsInput = z.input<typeof updateCompanyAiSettingsSchema>;

/** Rota do SUPERADMIN: tudo o que a empresa edita + ligar/desligar e modo padrão das novas conversas. */
export const updateAdminAiSettingsSchema = strictObject({
  ...companyAiShape,
  enabled: z.boolean({ error: "Valor inválido." }).optional(),
  // Pausado não faz sentido como modo inicial: só IA ou humano.
  defaultConversationMode: z.enum(DEFAULT_CONVERSATION_MODES, { error: "Modo inválido." }).optional(),
  // Fase 7: limite mensal de custo estimado (USD). null = sem limite.
  monthlyLimitUsd: z.lazy(() => usdAmountSchema).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateAdminAiSettingsInput = z.input<typeof updateAdminAiSettingsSchema>;
export type UpdateAiSettingsData = z.output<typeof updateAdminAiSettingsSchema>;

// Fase 6: mesmo período de calendário do Analytics (fuso da plataforma), para os números baterem com o relatório.
export const aiUsageQuerySchema = strictObject({
  period: z.enum(ANALYTICS_PERIODS, { error: "Período inválido." }).default(DEFAULT_ANALYTICS_PERIOD),
});
export type AiUsageQuery = z.output<typeof aiUsageQuerySchema>;

// ---------------------------------------------------------------- FASE 5

const maxConcurrentSchema = z
  .number({ error: "Informe o limite." })
  .int("O limite deve ser um número inteiro.")
  .min(1, "Mínimo de 1 atendimento.")
  .max(MAX_CONCURRENT_LIMIT, `Máximo de ${MAX_CONCURRENT_LIMIT} atendimentos.`);

/** Cadastro pela própria empresa: senha provisória, trocada obrigatoriamente no primeiro acesso. */
export const createTeamMemberSchema = strictObject({
  name: text("o nome", 2, 120),
  email: emailSchema,
  password: newPasswordSchema,
  role: z.enum(MEMBER_ROLES, { error: "Perfil inválido." }),
  maxConcurrent: maxConcurrentSchema.default(DEFAULT_MAX_CONCURRENT),
  canAttend: z.boolean({ error: "Valor inválido." }).default(true),
});
export type CreateTeamMemberInput = z.input<typeof createTeamMemberSchema>;
export type CreateTeamMemberData = z.output<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = strictObject({
  role: z.enum(MEMBER_ROLES, { error: "Perfil inválido." }).optional(),
  active: z.boolean({ error: "Valor inválido." }).optional(),
  maxConcurrent: maxConcurrentSchema.optional(),
  canAttend: z.boolean({ error: "Valor inválido." }).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: "Nada para atualizar." });
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

export const updateAvailabilitySchema = strictObject({
  availability: z.enum(AGENT_AVAILABILITIES, { error: "Disponibilidade inválida." }),
});
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

export const updateTeamSettingsSchema = strictObject({
  inactivityTimeoutMinutes: z
    .number({ error: "Informe o tempo." })
    .int("Use minutos inteiros.")
    .min(MIN_INACTIVITY_TIMEOUT_MINUTES, `Mínimo de ${MIN_INACTIVITY_TIMEOUT_MINUTES} minutos.`)
    .max(MAX_INACTIVITY_TIMEOUT_MINUTES, "Máximo de 30 dias."),
});
export type UpdateTeamSettingsInput = z.infer<typeof updateTeamSettingsSchema>;

export const transferConversationSchema = strictObject({
  toUserId: uuidSchema,
});
export type TransferConversationInput = z.infer<typeof transferConversationSchema>;


// ---------------------------------------------------------------- FASE 7

export const USD_LIMIT_MAX = 1_000_000;

/** Valor em USD com no máximo 2 casas (limites mensais). */
export const usdAmountSchema = z
  .number({ error: "Informe o valor em dólares." })
  .min(0.01, "O valor mínimo é US$ 0,01.")
  .max(USD_LIMIT_MAX, "Valor muito alto.")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use no máximo 2 casas decimais.");

/** Operações críticas exigem confirmação explícita também no backend (não só o diálogo da tela). */
const confirmation = z.literal(true, { error: "Confirme a operação." });

const timezoneSchema = z
  .string({ error: "Informe o fuso horário." })
  .trim()
  .min(1, "Informe o fuso horário.")
  .max(64, "Fuso horário inválido.")
  .refine(isValidTimeZone, "Fuso horário inválido (use o formato IANA, ex.: America/Sao_Paulo).");

/** Aba Empresa (somente o proprietário): nome comercial e fuso. O logotipo tem rota própria (upload). */
export const updateCompanyProfileSchema = strictObject({
  name: text("o nome comercial", 2, 120).optional(),
  timezone: timezoneSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>;

const scheduleDaysSchema = z
  .array(z.number().int().min(0).max(6), { error: "Dias inválidos." })
  .max(7, "Dias inválidos.")
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

export const weeklyScheduleSchema = strictObject({
  alwaysOn: z.boolean({ error: "Valor inválido." }),
  days: scheduleDaysSchema,
  start: timeSchema,
  end: timeSchema,
}).superRefine((data, ctx) => {
  if (data.alwaysOn) return;
  if (data.days.length === 0) ctx.addIssue({ code: "custom", path: ["days"], message: "Escolha ao menos um dia." });
  if (data.start === data.end) ctx.addIssue({ code: "custom", path: ["end"], message: "O término deve ser diferente do início." });
});
export type WeeklyScheduleInput = z.output<typeof weeklyScheduleSchema>;

/** Aba Horários: as três agendas são independentes; envie só as que mudaram. */
export const updateSchedulesSchema = strictObject({
  business: weeklyScheduleSchema.optional(),
  ai: weeklyScheduleSchema.optional(),
  team: weeklyScheduleSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateSchedulesInput = z.output<typeof updateSchedulesSchema>;

const dayOverrideSchema = strictObject({
  mode: z.enum(SCHEDULE_OVERRIDES, { error: "Opção inválida." }),
  start: z.preprocess((value) => (value === "" ? null : value), timeSchema.nullable().optional()),
  end: z.preprocess((value) => (value === "" ? null : value), timeSchema.nullable().optional()),
})
  .superRefine((data, ctx) => {
    if (data.mode !== "CUSTOM") return;
    if (!data.start) ctx.addIssue({ code: "custom", path: ["start"], message: "Informe o início." });
    if (!data.end) ctx.addIssue({ code: "custom", path: ["end"], message: "Informe o término." });
    if (data.start && data.start === data.end) ctx.addIssue({ code: "custom", path: ["end"], message: "O término deve ser diferente do início." });
  })
  // Fora do horário especial, horários não são guardados.
  .transform((data) => (data.mode === "CUSTOM" ? { mode: data.mode, start: data.start ?? null, end: data.end ?? null } : { mode: data.mode, start: null, end: null }));

export const dateOnlySchema = z.string({ error: "Informe a data." }).refine(isValidDate, "Data inválida (use AAAA-MM-DD).");

/** Data especial: cada agenda (negócio, IA, equipe) segue a semana, fecha ou usa um horário especial. */
export const scheduleExceptionSchema = strictObject({
  date: dateOnlySchema,
  label: text("a descrição", 2, 120),
  business: dayOverrideSchema,
  ai: dayOverrideSchema,
  team: dayOverrideSchema,
});
export type ScheduleExceptionInput = z.input<typeof scheduleExceptionSchema>;
export type ScheduleExceptionData = z.output<typeof scheduleExceptionSchema>;

export const calendarQuerySchema = strictObject({
  year: z.coerce.number().int().min(HOLIDAY_YEAR_MIN, "Ano inválido.").max(HOLIDAY_YEAR_MAX, "Ano inválido.").optional(),
});
export type CalendarQuery = z.output<typeof calendarQuerySchema>;

const autoMessageText = clearable(
  z.string().trim().min(2, "Mínimo de 2 caracteres.").max(AUTO_MESSAGE_MAX_LENGTH, `Máximo de ${AUTO_MESSAGE_MAX_LENGTH} caracteres.`),
);

/** Aba Mensagens: ligar/desligar e personalizar (texto vazio = volta ao padrão). */
export const updateAutoMessagesSchema = strictObject({
  welcomeEnabled: z.boolean({ error: "Valor inválido." }).optional(),
  welcomeMessage: autoMessageText,
  queueNoticeEnabled: z.boolean({ error: "Valor inválido." }).optional(),
  queueNoticeMessage: autoMessageText,
  afterHoursEnabled: z.boolean({ error: "Valor inválido." }).optional(),
  afterHoursMessage: autoMessageText,
  closingEnabled: z.boolean({ error: "Valor inválido." }).optional(),
  closingMessage: autoMessageText,
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateAutoMessagesInput = z.output<typeof updateAutoMessagesSchema>;

/** Aba Atendimento: limite de espera (alerta) e prazo de inatividade da equipe (o mesmo dado da Fase 5). */
export const updateServiceSettingsSchema = strictObject({
  maxQueueWaitMinutes: z
    .number({ error: "Informe o tempo." })
    .int("Use minutos inteiros.")
    .min(1, "Mínimo de 1 minuto.")
    .max(MAX_QUEUE_WAIT_LIMIT_MINUTES, "Máximo de 24 horas.")
    .optional(),
  inactivityTimeoutMinutes: updateTeamSettingsSchema.shape.inactivityTimeoutMinutes.optional(),
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdateServiceSettingsInput = z.infer<typeof updateServiceSettingsSchema>;

/** Aba Permissões (somente o proprietário): conjunto completo de grupos do membro. */
export const updateMemberPermissionsSchema = strictObject({
  permissions: z
    .array(z.enum(SETTINGS_PERMISSIONS, { error: "Permissão inválida." }), { error: "Permissões inválidas." })
    .max(SETTINGS_PERMISSIONS.length, "Permissões inválidas.")
    .transform((items) => [...new Set(items)].sort()),
  confirm: confirmation,
});
export type UpdateMemberPermissionsInput = z.output<typeof updateMemberPermissionsSchema>;

/** Pausar exige confirmação (interrompe as respostas automáticas); retomar não. */
export const aiPauseSchema = z.discriminatedUnion("action", [
  strictObject({ action: z.literal("PAUSE"), confirm: confirmation }),
  strictObject({ action: z.literal("RESUME") }),
], { error: "Ação inválida." });
export type AiPauseInput = z.infer<typeof aiPauseSchema>;

export const companySuspensionSchema = strictObject({ confirm: confirmation });
export type CompanySuspensionInput = z.infer<typeof companySuspensionSchema>;

/** Configuração da plataforma (somente SUPERADMIN). */
export const updatePlatformSettingsSchema = strictObject({
  supportEmail: clearable(emailSchema),
  supportWhatsapp: clearable(phoneSchema),
  defaultAiMonthlyLimitUsd: usdAmountSchema.nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, nonEmpty);
export type UpdatePlatformSettingsInput = z.output<typeof updatePlatformSettingsSchema>;
