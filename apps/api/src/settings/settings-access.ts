import { ForbiddenException } from "@nestjs/common";
import type { CompanyMember, SettingsPermission, User } from "@arthur-ai/database";
import { memberHasSettingsPermission, SETTINGS_PERMISSION_LABEL, SETTINGS_PERMISSIONS, type CompanySettingsPermissions } from "@arthur-ai/shared";

/**
 * FASE 7: quem edita cada grupo de configurações. A membership vem do CompanyAccessGuard, relida do banco a cada
 * requisição: uma revogação vale na próxima operação, sem depender de a tela ser recarregada.
 * - OWNER: tudo.
 * - ADMIN/AGENT: só os grupos concedidos individualmente pelo OWNER.
 * - SUPERADMIN: só o grupo da IA nas rotas da empresa (como na Fase 4); o restante é operação da própria empresa.
 */
export function canEditSettings(user: User, membership: CompanyMember | null, permission: SettingsPermission): boolean {
  if (user.globalRole === "SUPERADMIN" && !membership) return permission === "AI";
  return memberHasSettingsPermission(membership, permission);
}

export function requireSettingsPermission(user: User, membership: CompanyMember | null, permission: SettingsPermission): void {
  if (!canEditSettings(user, membership, permission)) {
    throw new ForbiddenException(`Você não tem permissão para alterar: ${SETTINGS_PERMISSION_LABEL[permission]}.`);
  }
}

export function isCompanyOwner(membership: CompanyMember | null): boolean {
  return membership?.role === "OWNER";
}

export function requireOwner(membership: CompanyMember | null, what: string): CompanyMember {
  if (!membership || membership.role !== "OWNER") throw new ForbiddenException(`Somente o proprietário da empresa pode ${what}.`);
  return membership;
}

export function settingsPermissionsOf(user: User, membership: CompanyMember | null): CompanySettingsPermissions {
  const owner = isCompanyOwner(membership);
  return {
    editAi: canEditSettings(user, membership, "AI"),
    editService: canEditSettings(user, membership, "SERVICE"),
    editSchedule: canEditSettings(user, membership, "SCHEDULE"),
    editMessages: canEditSettings(user, membership, "MESSAGES"),
    editCompany: owner,
    managePermissions: owner,
    granted: owner || !membership ? [] : SETTINGS_PERMISSIONS.filter((permission) => membership.settingsPermissions.includes(permission)),
  };
}

/**
 * Permissões iniciais de um membro novo. ADMIN cadastrado pelo proprietário (ou pelo SUPERADMIN) recebe todos os
 * grupos, como os administradores das fases anteriores; cadastrado por outro ADMIN, recebe no máximo os grupos de
 * quem cadastrou (nunca mais do que o próprio autor tem: sem escalonamento por uma conta criada por ele).
 * Funcionários começam sem grupos. Promover alguém a ADMIN depois não concede nada sozinho.
 */
export function initialSettingsPermissions(role: CompanyMember["role"], creator: CompanyMember | null): SettingsPermission[] {
  if (role !== "ADMIN") return [];
  if (!creator || creator.role === "OWNER") return [...SETTINGS_PERMISSIONS];
  return SETTINGS_PERMISSIONS.filter((permission) => creator.settingsPermissions.includes(permission));
}
