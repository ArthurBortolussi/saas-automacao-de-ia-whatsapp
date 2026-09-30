import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { DEFAULT_LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT_OPTIONS, LoginRateLimiter } from "./login-rate-limiter.js";
import { SessionService } from "./session.service.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    LoginRateLimiter,
    { provide: LOGIN_RATE_LIMIT_OPTIONS, useValue: DEFAULT_LOGIN_RATE_LIMIT },
  ],
  exports: [SessionService],
})
export class AuthModule {}
