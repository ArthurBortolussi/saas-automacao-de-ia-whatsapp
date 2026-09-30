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
    logger: env.NODE_ENV === "production" ? ["error", "warn", "log"] : ["error", "warn", "log", "debug"],
  });
  configureApp(app, env);
  if (env.NODE_ENV === "production" && env.TRUST_PROXY === false) {
    Logger.warn(
      "TRUST_PROXY=false: atrás do Next, todos os clientes chegam com o mesmo IP e o rate limit por IP vira um limite global. Veja o README.",
      "Bootstrap",
    );
  }
  await app.listen(env.API_PORT);
  Logger.log(`API ouvindo em http://localhost:${env.API_PORT}/api`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
