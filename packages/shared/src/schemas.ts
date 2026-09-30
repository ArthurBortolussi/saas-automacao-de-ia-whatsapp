import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "./cnpj.js";
import { BRAZILIAN_STATES, MEMBER_ROLES } from "./enums.js";

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
