import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { Prisma } from "@arthur-ai/database";
import type { ApiError, ApiErrorCode } from "@arthur-ai/shared";
import type { Response } from "express";

const REASON: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

function body(statusCode: number, message: string, extra: Partial<ApiError> = {}): ApiError {
  return { statusCode, error: REASON[statusCode] ?? "Error", message, ...extra };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Erros do body-parser (JSON malformado, payload grande) não são HttpException.
function bodyParserStatus(error: unknown): number | null {
  if (!isRecord(error) || typeof error["type"] !== "string") return null;
  const status = error["status"];
  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}

/** Formato único de erro: { statusCode, error, message, code?, details? }. Nunca expõe stack. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const payload = this.toApiError(exception);
    if (payload.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(payload.statusCode).json(payload);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") return body(status, res);
      const record = res as Record<string, unknown>;
      const message = typeof record["message"] === "string" ? record["message"] : exception.message;
      const extra: Partial<ApiError> = {};
      if (typeof record["code"] === "string") extra.code = record["code"] as ApiErrorCode;
      if (Array.isArray(record["details"])) extra.details = record["details"] as ApiError["details"];
      return body(status, message, extra);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2002":
          return body(HttpStatus.CONFLICT, "Registro duplicado.");
        case "P2003":
          return body(HttpStatus.CONFLICT, "Registro relacionado impede a operação.");
        case "P2025":
          return body(HttpStatus.NOT_FOUND, "Registro não encontrado.");
      }
    }

    const parserStatus = bodyParserStatus(exception);
    if (parserStatus === 413) return body(413, "Payload muito grande.");
    if (parserStatus) return body(400, "Corpo da requisição inválido.");

    return body(HttpStatus.INTERNAL_SERVER_ERROR, "Erro interno.");
  }
}
