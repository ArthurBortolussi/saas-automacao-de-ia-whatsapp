import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPrismaClient,
  type CompanyStatus,
  type ContactSource,
  type ContactStatus,
  type ConversationMode,
  type MemberRole,
} from "./index.js";
import { hashPassword } from "./password.js";
import { TokenCipher } from "./token-cipher.js";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Dados de DESENVOLVIMENTO. Senhas documentadas no README; nunca use em produção.
if (process.env["NODE_ENV"] === "production") {
  console.error("Seed recusado: NODE_ENV=production.");
  process.exit(1);
}

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const prisma = createPrismaClient(databaseUrl);

// Conversas fictícias. "c" = mensagem do cliente (INBOUND), "a" = resposta de atendente (OUTBOUND).
interface SeedConversation {
  mode: ConversationMode;
  unread: number;
  messages: ["c" | "a", string][];
}

interface SeedContact {
  name: string;
  phone: string;
  email?: string;
  status: ContactStatus;
  source: ContactSource;
  conversation?: SeedConversation;
}

const DEV_NOTE = "Contato fictício gerado pelo seed de desenvolvimento.";

interface SeedCompany {
  slug: string;
  name: string;
  industry: string;
  phone: string;
  city: string;
  state: string;
  status: CompanyStatus;
  member: { name: string; email: string; password: string; role: MemberRole };
  contacts: SeedContact[];
}

const companies: SeedCompany[] = [
  {
    slug: "empresa-demo-dev",
    name: "Empresa Demo (DEV)",
    industry: "Clínica odontológica",
    phone: "11999990001",
    city: "São Paulo",
    state: "SP",
    status: "ACTIVE",
    member: { name: "Dono Demo", email: "owner@demo.local", password: "demo-owner-dev-123", role: "OWNER" },
    contacts: [
      {
        name: "Mariana Exemplo",
        phone: "5511900000101",
        email: "mariana@exemplo.dev",
        status: "LEAD",
        source: "WHATSAPP",
        conversation: {
          mode: "AI",
          unread: 2,
          messages: [
            ["c", "Olá! Vocês atendem aos sábados?"],
            ["c", "Gostaria de agendar uma limpeza."],
          ],
        },
      },
      {
        name: "Carlos Exemplo",
        phone: "5511900000102",
        status: "QUALIFIED",
        source: "WEBSITE",
        conversation: {
          mode: "HUMAN",
          unread: 0,
          messages: [
            ["c", "Qual o valor do clareamento?"],
            ["a", "Olá, Carlos! O clareamento começa em R$ 600. Posso agendar uma avaliação?"],
            ["c", "Pode ser na quinta à tarde?"],
            ["a", "Quinta às 15h está livre. Confirmo para você?"],
          ],
        },
      },
      {
        name: "Fernanda Exemplo",
        phone: "5511900000103",
        status: "CUSTOMER",
        source: "REFERRAL",
        conversation: {
          mode: "PAUSED",
          unread: 1,
          messages: [
            ["c", "Preciso remarcar minha consulta."],
            ["a", "Claro! Vou verificar a agenda e retorno em seguida."],
            ["c", "Obrigada, aguardo."],
          ],
        },
      },
      { name: "Rafael Exemplo", phone: "5511900000104", status: "NEW", source: "MANUAL" },
      { name: "Juliana Exemplo", phone: "5511900000105", status: "LOST", source: "SOCIAL" },
    ],
  },
  {
    slug: "outra-empresa-dev",
    name: "Outra Empresa (DEV)",
    industry: "Imobiliária",
    phone: "21999990002",
    city: "Rio de Janeiro",
    state: "RJ",
    status: "ACTIVE",
    member: { name: "Dono Outra", email: "owner@outra.local", password: "outra-owner-dev-123", role: "OWNER" },
    contacts: [
      {
        // Mesmo telefone de um contato da Empresa Demo: permitido entre empresas diferentes.
        name: "Mariana (outra empresa) Exemplo",
        phone: "5511900000101",
        status: "NEW",
        source: "WHATSAPP",
        conversation: {
          mode: "AI",
          unread: 1,
          messages: [["c", "Bom dia, quero informações sobre apartamentos para alugar."]],
        },
      },
      { name: "Pedro Exemplo", phone: "5521900000201", status: "LEAD", source: "WEBSITE" },
    ],
  },
];

async function upsertUser(name: string, email: string, password: string, globalRole: "SUPERADMIN" | "USER") {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { name, email, passwordHash, globalRole, status: "ACTIVE", mustChangePassword: false },
    update: { name, passwordHash, globalRole, status: "ACTIVE", mustChangePassword: false },
  });
}

async function main() {
  const admin = await upsertUser("Super Admin", "admin@arthurai.local", "admin-dev-password-123", "SUPERADMIN");
  console.log(`SUPERADMIN: ${admin.email}`);

  for (const seed of companies) {
    const { member, slug, contacts: seedContacts, ...data } = seed;
    const company = await prisma.company.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    const user = await upsertUser(member.name, member.email, member.password, "USER");
    await prisma.companyMember.upsert({
      where: { userId: user.id },
      create: { companyId: company.id, userId: user.id, role: member.role },
      update: { companyId: company.id, role: member.role },
    });
    console.log(`Empresa: ${company.name} (${company.slug}) → ${member.role} ${user.email}`);

    for (const contactSeed of seedContacts) {
      const { conversation: conversationSeed, ...contactData } = contactSeed;
      const contact = await prisma.contact.upsert({
        where: { companyId_phone: { companyId: company.id, phone: contactData.phone } },
        create: { ...contactData, companyId: company.id, notes: DEV_NOTE },
        update: {},
      });
      // Idempotente: só cria a conversa de exemplo se o contato ainda não tiver nenhuma.
      if (!conversationSeed || (await prisma.conversation.count({ where: { contactId: contact.id } })) > 0) continue;

      const start = Date.now() - conversationSeed.messages.length * 5 * 60_000;
      const times = conversationSeed.messages.map((_, index) => new Date(start + index * 5 * 60_000));
      const last = conversationSeed.messages.at(-1);
      await prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
          data: {
            companyId: company.id,
            contactId: contact.id,
            mode: conversationSeed.mode,
            modeBeforePause: conversationSeed.mode === "PAUSED" ? "HUMAN" : null,
            assignedUserId: conversationSeed.mode === "AI" ? null : user.id,
            unreadCount: conversationSeed.unread,
            lastMessageAt: times.at(-1) ?? null,
            lastMessagePreview: last?.[1] ?? null,
          },
        });
        await tx.message.createMany({
          data: conversationSeed.messages.map(([who, body], index) => ({
            companyId: company.id,
            conversationId: conversation.id,
            direction: who === "c" ? "INBOUND" : "OUTBOUND",
            senderType: who === "c" ? "CONTACT" : "AGENT",
            senderUserId: who === "c" ? null : user.id,
            body,
            createdAt: times[index] ?? new Date(),
          })),
        });
      });
    }
    console.log(`  ${seedContacts.length} contatos fictícios`);
  }
}

/**
 * Número de WhatsApp FICTÍCIO para a Empresa Demo, usado com a Graph API simulada
 * (pnpm whatsapp:mock-graph). Só é criado se houver chave de criptografia e se a empresa
 * ainda não tiver número: nunca sobrescreve uma configuração real.
 */
async function seedSimulatedWhatsApp() {
  const key = process.env["WHATSAPP_TOKEN_ENCRYPTION_KEY"];
  if (!key) {
    console.log("WhatsApp: WHATSAPP_TOKEN_ENCRYPTION_KEY ausente, número simulado não criado.");
    return;
  }
  const company = await prisma.company.findUnique({ where: { slug: "empresa-demo-dev" } });
  if (!company) return;
  if (await prisma.whatsAppAccount.findUnique({ where: { companyId: company.id } })) {
    console.log("WhatsApp: Empresa Demo já tem número configurado (mantido).");
    return;
  }
  const cipher = new TokenCipher(Buffer.from(key, "base64"));
  await prisma.whatsAppAccount.create({
    data: {
      companyId: company.id,
      wabaId: "990000000000001",
      phoneNumberId: "990000000000101",
      displayPhoneNumber: "+55 11 90000-0000",
      verifiedName: "Empresa Demo (SIMULADO)",
      accessTokenCiphertext: cipher.encrypt("token-ficticio-da-graph-api-simulada", company.id),
      tokenUpdatedAt: new Date(),
      status: "PENDING",
    },
  });
  console.log("WhatsApp: número SIMULADO criado para a Empresa Demo (phone_number_id 990000000000101).");
}

/**
 * Fase 4: IA ligada e base de conhecimento FICTÍCIA para a Empresa Demo. Cria só o que não existe:
 * configurações já salvas e bases já preenchidas pelo desenvolvedor nunca são sobrescritas.
 */
async function seedAiDemo() {
  const company = await prisma.company.findUnique({ where: { slug: "empresa-demo-dev" } });
  if (!company) return;
  if (await prisma.aiSettings.findUnique({ where: { companyId: company.id } })) {
    console.log("IA: Empresa Demo já tem configuração de IA (mantida).");
  } else {
    await prisma.aiSettings.create({
      data: {
        companyId: company.id,
        enabled: true,
        assistantName: "Sofia",
        tone: "FRIENDLY",
        instructions: "Sempre que fizer sentido, ofereça agendar uma avaliação. Dados fictícios de desenvolvimento.",
      },
    });
    console.log("IA: ligada para a Empresa Demo (assistente Sofia).");
  }
  if ((await prisma.knowledgeEntry.count({ where: { companyId: company.id } })) > 0) {
    console.log("IA: base de conhecimento da Empresa Demo já tem informações (mantida).");
    return;
  }
  await prisma.knowledgeEntry.createMany({
    data: [
      { companyId: company.id, position: 0, category: "Atendimento", title: "Horário de funcionamento", content: "Segunda a sexta, das 8h às 18h. Sábado, das 8h às 12h. Fechado aos domingos e feriados." },
      { companyId: company.id, position: 1, category: "Atendimento", title: "Endereço", content: "Rua Fictícia, 123 – Centro, São Paulo/SP. Há estacionamento conveniado na mesma rua." },
      { companyId: company.id, position: 2, category: "Preços", title: "Clareamento dental", content: "Clareamento a laser: R$ 800,00 à vista ou em até 4x sem juros no cartão. Inclui avaliação." },
      { companyId: company.id, position: 3, category: "Preços", title: "Limpeza (profilaxia)", content: "Limpeza completa: R$ 180,00. Duração aproximada de 40 minutos." },
      { companyId: company.id, position: 4, category: "Políticas", title: "Convênios", content: "Atendemos os convênios Odonto Exemplo e Sorriso Fictício. Outros convênios: consultar a recepção." },
      { companyId: company.id, position: 5, category: "Preços", active: false, title: "Promoção antiga (inativa)", content: "Promoção encerrada: não deve ser usada pela IA." },
    ],
  });
  console.log("IA: 6 informações fictícias na base da Empresa Demo (1 inativa).");
}

main()
  .then(seedSimulatedWhatsApp)
  .then(seedAiDemo)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
