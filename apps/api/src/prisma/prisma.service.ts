import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaAdapter, PrismaClient } from "@arthur-ai/database";
import { ENV, type Env } from "../config/env.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: createPrismaAdapter(env.DATABASE_URL) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
