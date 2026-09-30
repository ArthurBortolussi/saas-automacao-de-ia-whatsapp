import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { Env } from "./config/env.js";

/** Configuração HTTP compartilhada entre main.ts e os testes e2e. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix("api");
  app.disable("x-powered-by");
  // Só confia em X-Forwarded-For vindo de proxies declarados em TRUST_PROXY (ver .env.example).
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(cookieParser());
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.enableShutdownHooks();
}
