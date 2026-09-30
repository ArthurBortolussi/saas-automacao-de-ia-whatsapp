import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from "@nestjs/common";
import type { Company, CompanyMember, User } from "@arthur-ai/database";
import type { Request } from "express";
import type { AuthContext, TenantContext } from "../request-context.js";

// Estes decorators só leem o que os guards já resolveram; nunca consultam o cliente.
function requireAuth(ctx: ExecutionContext): AuthContext {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new InternalServerErrorException("Contexto de autenticação ausente.");
  return auth;
}

function requireTenant(ctx: ExecutionContext): TenantContext {
  const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
  if (!tenant) throw new InternalServerErrorException("Rota sem CompanyAccessGuard.");
  return tenant;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => requireAuth(ctx).user);

export const CurrentSessionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => requireAuth(ctx).sessionId,
);

export const CurrentCompany = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Company => requireTenant(ctx).company,
);

export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CompanyMember | null => requireTenant(ctx).membership,
);
