import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient, type CompanyStatus, type MemberRole } from "./index.js";
import { hashPassword } from "./password.js";

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

interface SeedCompany {
  slug: string;
  name: string;
  industry: string;
  phone: string;
  city: string;
  state: string;
  status: CompanyStatus;
  member: { name: string; email: string; password: string; role: MemberRole };
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
    const { member, slug, ...data } = seed;
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
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
