import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Company, User, WhatsAppAccount } from "@arthur-ai/database";
import type {
  UpdateWhatsAppAccountData,
  WhatsAppAccountAction,
  WhatsAppAccountAdminView,
  WhatsAppAdminResponse,
  WhatsAppCompanyStatus,
  WhatsAppPlatformInfo,
} from "@arthur-ai/shared";
import { AUDIT_ACTIONS, AuditService } from "../audit/audit.service.js";
import { uniqueViolationIndex } from "../common/prisma-errors.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CloudApiClient, type NumberCredentials } from "./cloud-api.client.js";
import { TokenCipher } from "@arthur-ai/database/token-cipher";
import { WhatsAppApiError } from "./whatsapp-errors.js";

export const WEBHOOK_PATH = "/api/webhooks/whatsapp";
const DISABLED_MESSAGE = "A integração com o WhatsApp não está habilitada neste servidor (variáveis WHATSAPP_* ausentes).";

function toAdminView(account: WhatsAppAccount): WhatsAppAccountAdminView {
  return {
    id: account.id,
    wabaId: account.wabaId,
    phoneNumberId: account.phoneNumberId,
    displayPhoneNumber: account.displayPhoneNumber,
    verifiedName: account.verifiedName,
    status: account.status,
    hasAccessToken: account.accessTokenCiphertext.length > 0,
    tokenUpdatedAt: account.tokenUpdatedAt.toISOString(),
    lastCheckedAt: account.lastCheckedAt?.toISOString() ?? null,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Configuração do número de cada empresa. O token é cifrado com o companyId como AAD e só é
 * decifrado em memória, para a chamada à Meta. Nenhum método devolve o token.
 */
@Injectable()
export class WhatsAppAccountsService {
  private readonly cipher: TokenCipher | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: CloudApiClient,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.cipher = env.whatsapp.encryptionKey ? new TokenCipher(env.whatsapp.encryptionKey) : null;
  }

  platformInfo(): WhatsAppPlatformInfo {
    const { enabled, simulated, graphApiVersion, missing } = this.env.whatsapp;
    return { enabled, simulated, graphApiVersion, webhookPath: WEBHOOK_PATH, missing };
  }

  async getAdmin(company: Company): Promise<WhatsAppAdminResponse> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id } });
    return { platform: this.platformInfo(), account: account ? toAdminView(account) : null };
  }

  /** O que a própria empresa pode ver: estado e número, nada técnico. */
  async companyStatus(company: Company): Promise<WhatsAppCompanyStatus> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id } });
    return {
      connected: account?.status === "ACTIVE",
      status: account?.status ?? null,
      displayPhoneNumber: account?.displayPhoneNumber ?? null,
      verifiedName: account?.verifiedName ?? null,
    };
  }

  async upsert(company: Company, data: UpdateWhatsAppAccountData, actor: User): Promise<WhatsAppAdminResponse> {
    const cipher = this.requireCipher();
    const existing = await this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id } });
    if (!existing && !data.accessToken) throw new BadRequestException("Informe o token de acesso.");

    const tokenChange = data.accessToken
      ? { accessTokenCiphertext: cipher.encrypt(data.accessToken, company.id), tokenUpdatedAt: new Date() }
      : {};
    const fields = {
      wabaId: data.wabaId,
      phoneNumberId: data.phoneNumberId,
      displayPhoneNumber: data.displayPhoneNumber,
      verifiedName: data.verifiedName ?? null,
    };
    // Qualquer mudança de dados volta para PENDING até o próximo teste (exceto se estava desativada).
    const reset = { lastErrorCode: null, lastErrorMessage: null, lastErrorAt: null, lastCheckedAt: null };

    try {
      await this.prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.whatsAppAccount.update({
            where: { companyId: company.id },
            data: { ...fields, ...tokenChange, ...reset, status: existing.status === "DISABLED" ? "DISABLED" : "PENDING" },
          });
        } else {
          await tx.whatsAppAccount.create({
            data: {
              companyId: company.id,
              ...fields,
              accessTokenCiphertext: tokenChange.accessTokenCiphertext ?? "",
              tokenUpdatedAt: new Date(),
              status: "PENDING",
            },
          });
        }
        await this.audit.record(
          {
            action: existing ? AUDIT_ACTIONS.WHATSAPP_ACCOUNT_UPDATED : AUDIT_ACTIONS.WHATSAPP_ACCOUNT_CREATED,
            actorUserId: actor.id,
            entityType: "WhatsAppAccount",
            entityId: company.id,
            companyId: company.id,
            // Nunca o token: só se ele foi trocado.
            metadata: { phoneNumberId: data.phoneNumberId, wabaId: data.wabaId, tokenChanged: Boolean(data.accessToken) },
          },
          tx,
        );
      });
    } catch (error) {
      if (uniqueViolationIndex(error) === "WhatsAppAccount_phoneNumberId_key") {
        // Não revela qual empresa usa o número.
        throw new ConflictException("Este Phone Number ID já está conectado a outra empresa.");
      }
      throw error;
    }
    return this.getAdmin(company);
  }

  async runAction(company: Company, action: WhatsAppAccountAction, actor: User): Promise<WhatsAppAdminResponse> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { companyId: company.id } });
    if (!account) throw new NotFoundException("Esta empresa ainda não tem WhatsApp configurado.");

    if (action === "TEST") {
      if (account.status === "DISABLED") throw new ConflictException("Reative a integração antes de testar.");
      await this.testConnection(account);
    } else {
      await this.prisma.whatsAppAccount.update({
        where: { companyId: company.id },
        data: { status: action === "DISABLE" ? "DISABLED" : "PENDING" },
      });
    }
    await this.audit.record({
      action:
        action === "TEST"
          ? AUDIT_ACTIONS.WHATSAPP_ACCOUNT_TESTED
          : action === "DISABLE"
            ? AUDIT_ACTIONS.WHATSAPP_ACCOUNT_DISABLED
            : AUDIT_ACTIONS.WHATSAPP_ACCOUNT_ENABLED,
      actorUserId: actor.id,
      entityType: "WhatsAppAccount",
      entityId: company.id,
      companyId: company.id,
    });
    return this.getAdmin(company);
  }

  /** Conta usada por um webhook (roteamento por phone_number_id). */
  findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccount | null> {
    return this.prisma.whatsAppAccount.findUnique({ where: { phoneNumberId } });
  }

  /**
   * Credenciais para ENVIAR em nome de uma empresa. Recebe só o companyId da conversa já validada:
   * não existe caminho para usar o número de outra empresa.
   */
  async credentialsFor(companyId: string): Promise<{ account: WhatsAppAccount; credentials: NumberCredentials } | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { companyId } });
    if (!account || !this.cipher || !account.accessTokenCiphertext) return null;
    return {
      account,
      credentials: { phoneNumberId: account.phoneNumberId, accessToken: this.cipher.decrypt(account.accessTokenCiphertext, companyId) },
    };
  }

  /** Registra erro de credencial vindo do envio (ex.: token expirado) sem expor detalhes. */
  async markError(companyId: string, error: WhatsAppApiError): Promise<void> {
    await this.prisma.whatsAppAccount.updateMany({
      where: { companyId, status: { not: "DISABLED" } },
      data: { status: "ERROR", lastErrorCode: error.code, lastErrorMessage: error.safeMessage, lastErrorAt: new Date() },
    });
  }

  private async testConnection(account: WhatsAppAccount): Promise<void> {
    const loaded = await this.credentialsFor(account.companyId);
    if (!loaded) throw new ServiceUnavailableException(DISABLED_MESSAGE);
    try {
      const info = await this.client.getPhoneNumber(loaded.credentials);
      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status: "ACTIVE",
          lastCheckedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorAt: null,
          ...(info.verifiedName ? { verifiedName: info.verifiedName.slice(0, 120) } : {}),
        },
      });
    } catch (error) {
      if (!(error instanceof WhatsAppApiError)) throw error;
      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status: "ERROR",
          lastCheckedAt: new Date(),
          lastErrorCode: error.code,
          lastErrorMessage: error.safeMessage,
          lastErrorAt: new Date(),
        },
      });
    }
  }

  private requireCipher(): TokenCipher {
    if (!this.env.whatsapp.enabled || !this.cipher) throw new ServiceUnavailableException(DISABLED_MESSAGE);
    return this.cipher;
  }
}
