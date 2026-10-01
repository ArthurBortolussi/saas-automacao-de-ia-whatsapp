import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ENV, type Env } from "../../config/env.js";
import { SKIP_ORIGIN_CHECK } from "../decorators/skip-origin-check.decorator.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defesa CSRF complementar ao SameSite=Lax: toda requisição mutável precisa vir da origem do web.
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [context.getHandler(), context.getClass()])) return true;
    if (request.headers.origin !== this.env.WEB_ORIGIN) {
      throw new ForbiddenException("Origem da requisição não permitida.");
    }
    return true;
  }
}
