import type {
  CompanyStatus as SharedCompanyStatus,
  GlobalRole as SharedGlobalRole,
  MemberRole as SharedMemberRole,
  UserStatus as SharedUserStatus,
} from "@arthur-ai/shared";
import type { CompanyStatus, GlobalRole, MemberRole, UserStatus } from "./generated/prisma/client.js";

// Falha o typecheck se os enums do Prisma e do pacote shared divergirem.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type EnumParity = [
  Assert<Equals<GlobalRole, SharedGlobalRole>>,
  Assert<Equals<UserStatus, SharedUserStatus>>,
  Assert<Equals<CompanyStatus, SharedCompanyStatus>>,
  Assert<Equals<MemberRole, SharedMemberRole>>,
];
