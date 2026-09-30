import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { API_ERROR_CODES } from "@arthur-ai/shared";
import type { Request } from "express";
import { ALLOW_WHILE_PASSWORD_CHANGE } from "../decorators/allow-password-change.decorator.js";

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request>().auth?.user;
    if (!user?.mustChangePassword) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new ForbiddenException({
      message: "Troque sua senha para continuar.",
      code: API_ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
    });
  }
}
