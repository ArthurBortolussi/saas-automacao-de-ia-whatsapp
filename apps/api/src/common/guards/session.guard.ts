import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { SessionService } from "../../auth/session.service.js";
import { IS_PUBLIC } from "../decorators/public.decorator.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.sessions.readToken(request);
    const auth = token ? await this.sessions.validate(token) : null;
    if (!auth) throw new UnauthorizedException("Sessão inválida ou expirada.");
    request.auth = auth;
    return true;
  }
}
