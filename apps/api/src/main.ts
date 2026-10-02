import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { loadEnv } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Corpo bruto disponível em req.rawBody: necessário para validar a assinatura dos webhooks.
    rawBody: true,
    logger: env.NODE_ENV === "production" ? ["error", "warn", "log"] : ["error", "warn", "log", "debug"],
  });
  configureApp(app, env);
  if (env.NODE_ENV === "production" && env.TRUST_PROXY === false) {
    Logger.warn(
      "TRUST_PROXY=false: atrás do Next, todos os clientes chegam com o mesmo IP e o rate limit por IP vira um limite global. Veja o README.",
      "Bootstrap",
    );
  }
  // O proxy do Next reaproveita conexões. Se a API fechar uma conexão ociosa no mesmo instante em
  // que o Next a reutiliza, a requisição falha com "socket hang up" (o padrão do Node é 5s, igual ao
  // intervalo de polling da Inbox). A API passa a manter conexões por mais tempo que o cliente.
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await app.listen(env.API_PORT);
  Logger.log(`API ouvindo em http://localhost:${env.API_PORT}/api`, "Bootstrap");
  const { whatsapp } = env;
  Logger.log(
    whatsapp.enabled
      ? `WhatsApp: habilitado (Graph API ${whatsapp.graphApiVersion}${whatsapp.simulated ? `, SIMULADA em ${whatsapp.graphBaseUrl}` : ""})`
      : "WhatsApp: desabilitado (variáveis WHATSAPP_* ausentes). O restante do sistema funciona normalmente.",
    "Bootstrap",
  );
  // Nunca a chave: só se existe, o modelo e para onde as chamadas vão.
  const { ai } = env;
  Logger.log(
    ai.configured
      ? `IA: configurada (modelo ${ai.model}, esforço ${ai.effort}${ai.simulated ? `, API SIMULADA em ${ai.baseUrl}` : ""})`
      : "IA: não configurada (ANTHROPIC_API_KEY ausente). Nenhuma resposta automática; o restante do sistema funciona normalmente.",
    "Bootstrap",
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
