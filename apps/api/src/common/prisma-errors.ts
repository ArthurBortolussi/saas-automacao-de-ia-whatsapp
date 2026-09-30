import { Prisma } from "@arthur-ai/database";

/**
 * Nome do índice único violado num erro P2002, ou null.
 * Com driver adapter (Prisma 7), o nome vem em meta.driverAdapterError.cause.constraint.index,
 * e não em meta.target como nas versões antigas.
 */
export function uniqueViolationIndex(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = error.meta as
    | { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } }
    | undefined;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === "string" ? index : null;
}
