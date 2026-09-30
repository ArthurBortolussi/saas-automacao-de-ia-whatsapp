import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { ENV, type Env } from "../../config/env.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defesa CSRF complementar ao SameSite=Lax: toda requisição mutável precisa vir da origem do web.
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.headers.origin !== this.env.WEB_ORIGIN) {
      throw new ForbiddenException("Origem da requisição não permitida.");
    }
    return true;
  }
}
