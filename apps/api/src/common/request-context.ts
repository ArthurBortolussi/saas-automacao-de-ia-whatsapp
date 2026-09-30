import type { Company, CompanyMember, User } from "@arthur-ai/database";

export interface AuthContext {
  user: User;
  sessionId: string;
}

export interface TenantContext {
  company: Company;
  // null quando o acesso é de um SUPERADMIN sem vínculo com a empresa.
  membership: CompanyMember | null;
}
