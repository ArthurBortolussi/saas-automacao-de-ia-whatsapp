import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { CompanyStatus, ConversationMode, GlobalRole, MemberRole, UserStatus } from "@arthur-ai/database";
import { hashPassword } from "@arthur-ai/database/password";
import request from "supertest";
import { expect } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { LOGIN_RATE_LIMIT_OPTIONS, type LoginRateLimitOptions } from "../src/auth/login-rate-limiter.js";
import { loadEnv } from "../src/config/env.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "senha-de-teste-123";

// Limites altos para que as suítes não esbarrem no rate limit; a suíte de rate limit usa os seus.
const RELAXED_RATE_LIMIT: LoginRateLimitOptions = { windowMs: 60_000, maxAttemptsPerIp: 10_000, maxFailuresPerEmail: 10_000 };

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: ReturnType<typeof request>;
}

export async function createTestApp(rateLimit: LoginRateLimitOptions = RELAXED_RATE_LIMIT): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LOGIN_RATE_LIMIT_OPTIONS)
    .useValue(rateLimit)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ["error"], rawBody: true });
  configureApp(app, loadEnv());
  await app.init();
  return { app, prisma: app.get(PrismaService), http: request(app.getHttpServer()) };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AiUsageAlert", "AiBudgetReservation", "CompanyLogo", "PlatformSettings", "ScheduleException", "CompanySettings", "ConversationCycle", "ConversationAssignment", "TeamSettings", "AiRun", "AiReplyTask", "KnowledgeEntry", "AiSettings", "WhatsAppWebhookEvent", "WhatsAppAccount", "Message", "Conversation", "Contact", "AuditLog", "Session", "CompanyMember", "Company", "User" RESTART IDENTITY CASCADE',
  );
}

let sequence = 0;
const unique = () => `${Date.now().toString(36)}${(sequence++).toString(36)}`;

export async function createUser(
  prisma: PrismaService,
  options: { globalRole?: GlobalRole; status?: UserStatus; mustChangePassword?: boolean; email?: string } = {},
) {
  return prisma.user.create({
    data: {
      name: "Usuário Teste",
      email: options.email ?? `user-${unique()}@test.local`,
      passwordHash: await hashPassword(PASSWORD),
      globalRole: options.globalRole ?? "USER",
      status: options.status ?? "ACTIVE",
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
}

export async function createCompany(prisma: PrismaService, options: { status?: CompanyStatus; name?: string } = {}) {
  const id = unique();
  return prisma.company.create({
    data: {
      name: options.name ?? `Empresa ${id}`,
      slug: `empresa-${id}`,
      industry: "Teste",
      phone: "11999999999",
      status: options.status ?? "ACTIVE",
    },
  });
}

export async function createMember(
  prisma: PrismaService,
  companyId: string,
  options: { role?: MemberRole; mustChangePassword?: boolean; status?: UserStatus } = {},
) {
  const user = await createUser(prisma, options);
  const role = options.role ?? "OWNER";
  // Fase 7: mesma regra da API — ADMIN cadastrado pelo proprietário (ou existente antes da Fase 7) tem todos os grupos.
  const settingsPermissions = role === "ADMIN" ? (["AI", "SERVICE", "SCHEDULE", "MESSAGES"] as const) : [];
  await prisma.companyMember.create({ data: { companyId, userId: user.id, role, settingsPermissions: [...settingsPermissions] } });
  return user;
}

/** Faz login pelo endpoint real e devolve o header Cookie da sessão. */
export async function login(http: TestContext["http"], email: string, password = PASSWORD): Promise<string> {
  const response = await http.post("/api/auth/login").set("Origin", ORIGIN).send({ email, password });
  expect(response.status).toBe(200);
  const setCookie = response.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = setCookie?.find((value) => value.startsWith("aai_session="));
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  return (cookie ?? "").split(";")[0] ?? "";
}


let phoneSequence = 0;
/** Telefone único e válido (dígitos com DDI 55). */
export function uniquePhone(): string {
  phoneSequence += 1;
  return `55119${String(Date.now() % 10_000_000).padStart(7, "0").slice(0, 4)}${String(phoneSequence).padStart(4, "0")}`;
}

export async function createContactRow(prisma: PrismaService, companyId: string, name = "Contato Teste") {
  return prisma.contact.create({ data: { companyId, name, phone: uniquePhone() } });
}

/** Conversa com mensagens recebidas não lidas, como chegariam por um canal externo. */
export async function createConversationRow(
  prisma: PrismaService,
  companyId: string,
  contactId: string,
  options: { mode?: ConversationMode; inbound?: string[] } = {},
) {
  const inbound = options.inbound ?? [];
  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      contactId,
      mode: options.mode ?? "AI",
      unreadCount: inbound.length,
      lastMessageAt: inbound.length ? new Date() : null,
      lastMessagePreview: inbound.at(-1) ?? null,
    },
  });
  for (const [index, body] of inbound.entries()) {
    await prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        body,
        createdAt: new Date(Date.now() - (inbound.length - index) * 1000),
      },
    });
  }
  return conversation;
}
