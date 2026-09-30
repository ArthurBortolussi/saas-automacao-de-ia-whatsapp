import type { MeResponse } from "@arthur-ai/shared";

/** Para onde mandar o usuário logado. Só navegação: a autorização real está na API. */
export function homePathFor(me: MeResponse): string {
  if (me.user.mustChangePassword) return "/change-password";
  if (me.user.globalRole === "SUPERADMIN" && !me.membership) return "/admin";
  return "/dashboard";
}
