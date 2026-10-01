import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "./cnpj.js";
import { CONVERSATION_ACTIONS } from "./conversation-rules.js";
import { BRAZILIAN_STATES, CONTACT_SOURCES, CONTACT_STATUSES, MEMBER_ROLES } from "./enums.js";
import { normalizePhone } from "./phone.js";

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

export const INBOX_FILTERS = ["all", "ai", "human", "paused", "unread"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const listConversationsQuerySchema = strictObject({
  filter: z.enum(INBOX_FILTERS, { error: "Filtro inválido." }).default("all"),
  contactId: optional(uuidSchema),
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
