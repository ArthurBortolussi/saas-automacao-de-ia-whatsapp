import type { CompanyMember, User } from "@arthur-ai/database";

/** Quem pode editar a IA e a base: SUPERADMIN em qualquer empresa; OWNER/ADMIN só na própria. AGENT só consulta. */
export function canManageCompanyAi(user: User, membership: CompanyMember | null): boolean {
  return user.globalRole === "SUPERADMIN" || membership?.role === "OWNER" || membership?.role === "ADMIN";
}
