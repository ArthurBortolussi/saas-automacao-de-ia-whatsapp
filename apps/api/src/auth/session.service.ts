import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sessionCookieName } from "@arthur-ai/shared";
import type { CookieOptions, Request, Response } from "express";
import { ENV, type Env } from "../config/env.js";
import type { AuthContext } from "../common/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Token de 256 bits: SHA-256 simples basta (não é senha, não há o que forçar por dicionário).
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class SessionService {
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.cookieName = sessionCookieName(env.cookieSecure);
    this.cookieOptions = { httpOnly: true, sameSite: "lax", secure: env.cookieSecure, path: "/" };
  }

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);
    await this.prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
    return { token, expiresAt };
  }

  /** Consulta o banco a cada request: logout e desativação têm efeito imediato. */
  async validate(token: string): Promise<AuthContext | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    if (session.user.status !== "ACTIVE") return null;
    return { user: session.user, sessionId: session.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeOthers(userId: string, keepSessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
  }

  readToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[this.cookieName];
    return typeof value === "string" ? value : undefined;
  }

  setCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.cookieName, token, { ...this.cookieOptions, expires: expiresAt });
  }

  clearCookie(response: Response): void {
    response.clearCookie(this.cookieName, this.cookieOptions);
  }
}
