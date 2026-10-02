import type { AgentAvailability, MemberRole } from "@arthur-ai/database";
import { createMember, login, ORIGIN, type TestContext } from "./helpers.js";

export interface MemberHandle {
  id: string;
  email: string;
  cookie: string;
}

/** Funcionário de teste já logado, com disponibilidade/limite/permissão definidos direto no banco. */
export async function addMember(
  ctx: TestContext,
  companyId: string,
  options: { role?: MemberRole; availability?: AgentAvailability; maxConcurrent?: number; canAttend?: boolean } = {},
): Promise<MemberHandle> {
  const user = await createMember(ctx.prisma, companyId, { role: options.role ?? "AGENT" });
  await ctx.prisma.companyMember.update({
    where: { companyId_userId: { companyId, userId: user.id } },
    data: {
      availability: options.availability ?? "AWAY",
      maxConcurrent: options.maxConcurrent ?? 5,
      canAttend: options.canAttend ?? true,
    },
  });
  return { id: user.id, email: user.email, cookie: await login(ctx.http, user.email) };
}

/** Atalhos HTTP autenticados (com Origin nas mutações, como o navegador). */
export function as(ctx: TestContext, cookie: string) {
  return {
    get: (path: string) => ctx.http.get(`/api${path}`).set("Cookie", cookie),
    post: (path: string, body: object = {}) => ctx.http.post(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN).send(body),
    patch: (path: string, body: object) => ctx.http.patch(`/api${path}`).set("Cookie", cookie).set("Origin", ORIGIN).send(body),
  };
}
