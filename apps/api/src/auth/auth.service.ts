import { HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import type { User } from "@arthur-ai/database";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@arthur-ai/database/password";
import type { ChangePasswordInput, LoginInput, MeResponse } from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { logoVersion } from "../companies/company.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { SessionService } from "./session.service.js";

export interface LoginContext {
  ip: string;
  userAgent: string | undefined;
}

const INVALID_CREDENTIALS = "Credenciais inválidas.";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginRateLimiter,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, ctx: LoginContext): Promise<{ token: string; expiresAt: Date; user: User }> {
    const retryAfter = this.limiter.retryAfter(ctx.ip, input.email);
    if (retryAfter !== null) {
      throw new HttpException(
        { message: "Muitas tentativas. Tente novamente em alguns minutos.", retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.limiter.registerAttempt(ctx.ip);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Sempre roda um verify argon2, exista o e-mail ou não, para não vazar existência pelo tempo.
    const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : await verifyAgainstDummy(input.password);

    if (!user || !passwordOk || user.status !== "ACTIVE") {
      this.limiter.registerFailure(input.email);
      const reason = !user ? "unknown_email" : !passwordOk ? "invalid_password" : "user_inactive";
      await this.audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        actorUserId: user?.id ?? null,
        entityType: "User",
        entityId: user?.id ?? null,
        metadata: { email: input.email, reason, ip: ctx.ip, userAgent: ctx.userAgent ?? null },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.limiter.clearFailures(input.email);
    const session = await this.sessions.create(user.id);
    await this.audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorUserId: user.id,
      entityType: "User",
      entityId: user.id,
      metadata: { ip: ctx.ip, userAgent: ctx.userAgent ?? null },
    });
    return { ...session, user };
  }

  async changePassword(user: User, sessionId: string, input: ChangePasswordInput): Promise<void> {
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException("Senha atual incorreta.");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
      await tx.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } });
      await this.audit.record(
        { action: AUDIT_ACTIONS.PASSWORD_CHANGED, actorUserId: user.id, entityType: "User", entityId: user.id },
        tx,
      );
    });
  }

  async me(user: User): Promise<MeResponse> {
    // FASE 1: no máximo um vínculo por usuário (CompanyMember.userId único).
    const membership = await this.prisma.companyMember.findFirst({
      where: { userId: user.id },
      include: { company: { select: { id: true, name: true, slug: true, status: true, logo: { select: { updatedAt: true } } } } },
    });
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        globalRole: user.globalRole,
        mustChangePassword: user.mustChangePassword,
      },
      membership: membership
        ? {
            role: membership.role,
            company: {
              id: membership.company.id,
              name: membership.company.name,
              slug: membership.company.slug,
              status: membership.company.status,
              logoVersion: logoVersion(membership.company.logo?.updatedAt),
            },
            availability: membership.availability,
          }
        : null,
    };
  }
}
