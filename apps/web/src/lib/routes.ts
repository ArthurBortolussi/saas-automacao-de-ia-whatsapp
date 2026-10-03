import type { MeResponse } from "@arthur-ai/shared";

/** Para onde mandar o usuário logado. Só navegação: a autorização real está na API. */
export function homePathFor(me: MeResponse): string {
  if (me.user.mustChangePassword) return "/change-password";
  if (me.user.globalRole === "SUPERADMIN" && !me.membership) return "/admin";
  // Fase 7: empresa suspensa vai direto para a tela de suspensão (a API recusa o painel).
  if (me.membership && (me.membership.company.status === "PAUSED" || me.membership.company.status === "INACTIVE")) return "/suspended";
  return "/dashboard";
}
