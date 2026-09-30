import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request>().auth?.user;
    if (user?.globalRole !== "SUPERADMIN") throw new ForbiddenException("Acesso restrito.");
    return true;
  }
}
