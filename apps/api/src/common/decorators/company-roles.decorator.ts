import { SetMetadata } from "@nestjs/common";
import type { MemberRole } from "@arthur-ai/shared";

export const COMPANY_ROLES = "tenant:roles";
/**
 * Restringe uma rota tenant-scoped a roles específicas do membro. SUPERADMIN não é afetado.
 * Sem este decorator, qualquer membro da empresa acessa.
 */
export const CompanyRoles = (...roles: MemberRole[]) => SetMetadata(COMPANY_ROLES, roles);
