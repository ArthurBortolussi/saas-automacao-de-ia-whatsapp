import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";
import { OriginGuard } from "./common/guards/origin.guard.js";
import { PasswordChangeGuard } from "./common/guards/password-change.guard.js";
import { SessionGuard } from "./common/guards/session.guard.js";
import { createValidationPipe } from "./common/validation.js";
import { CompaniesModule } from "./companies/companies.module.js";
import { ContactsModule } from "./contacts/contacts.module.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
import { ConfigModule } from "./config/config.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { WhatsAppModule } from "./whatsapp/whatsapp.module.js";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    CompaniesModule,
    AdminModule,
    ContactsModule,
    ConversationsModule,
    WhatsAppModule,
  ],
  providers: [
    // Guards globais, nesta ordem: Origin (CSRF) → sessão (401) → troca de senha obrigatória (403).
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
