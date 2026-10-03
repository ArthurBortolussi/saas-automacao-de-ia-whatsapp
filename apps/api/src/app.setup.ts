import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { Env } from "./config/env.js";
import { LOGO_CONTENT_TYPES, LOGO_MAX_BYTES } from "./settings/logo.js";

/** Configuração HTTP compartilhada entre main.ts e os testes e2e. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix("api");
  app.disable("x-powered-by");
  // Só confia em X-Forwarded-For vindo de proxies declarados em TRUST_PROXY (ver .env.example).
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(cookieParser());
  // Fase 7: upload do logotipo como corpo binário (só estes tipos; o conteúdo é conferido de novo pelos bytes).
  // Limite um pouco acima do aceito, para a API responder com a mensagem própria em vez do erro do parser.
  app.useBodyParser("raw", { type: [...LOGO_CONTENT_TYPES], limit: LOGO_MAX_BYTES + 1024 });
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.enableShutdownHooks();
}
