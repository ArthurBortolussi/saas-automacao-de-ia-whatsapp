import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { User } from "@arthur-ai/database";
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
  type MeResponse,
} from "@arthur-ai/shared";
import type { Request, Response } from "express";
import { AllowWhilePasswordChange } from "../common/decorators/allow-password-change.decorator.js";
import { CurrentSessionId, CurrentUser } from "../common/decorators/context.decorators.js";
import { Public } from "../common/decorators/public.decorator.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    const { token, expiresAt, user } = await this.auth.login(body, {
      ip: request.ip ?? "unknown",
      userAgent: request.get("user-agent")?.slice(0, 255),
    });
    this.sessions.setCookie(response, token, expiresAt);
    return this.auth.me(user);
  }

  @AllowWhilePasswordChange()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentSessionId() sessionId: string, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.revoke(sessionId);
    this.sessions.clearCookie(response);
  }

  @AllowWhilePasswordChange()
  @Get("me")
  me(@CurrentUser() user: User): Promise<MeResponse> {
    return this.auth.me(user);
  }

  @AllowWhilePasswordChange()
  @Post("change-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: User,
    @CurrentSessionId() sessionId: string,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
  ): Promise<void> {
    return this.auth.changePassword(user, sessionId, body);
  }
}
