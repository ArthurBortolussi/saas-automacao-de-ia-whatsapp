import { BadRequestException, StandardSchemaValidationPipe } from "@nestjs/common";

type Issue = { message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined };

// Os schemas Zod de @arthur-ai/shared são declarados na rota: @Body({ schema }).
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues: readonly Issue[]) =>
      new BadRequestException({
        message: "Dados inválidos.",
        details: issues.map((issue) => ({
          path: (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join("."),
          message: issue.message,
        })),
      }),
  });
}
