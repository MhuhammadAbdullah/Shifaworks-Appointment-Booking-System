import { formatDocumentNumber, type DocumentPrefix } from "@booking/shared";
import type { DbClient } from "./prisma.js";

/**
 * Atomically allocates the next human-readable number for a prefix/year.
 *
 * The upsert takes a row lock on the counter, so concurrent callers are
 * serialized per (organization, prefix, year) and never receive the same
 * value. Call this inside the business transaction that creates the record:
 * if that transaction rolls back, the increment rolls back with it.
 */
export async function nextDocumentNumber(
  db: DbClient,
  organizationId: string,
  prefix: DocumentPrefix,
  year: number,
): Promise<string> {
  const rows = await db.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "document_sequences" ("organizationId", "prefix", "year", "lastValue", "updatedAt")
    VALUES (${organizationId}::uuid, ${prefix}, ${year}, 1, now())
    ON CONFLICT ("organizationId", "prefix", "year")
    DO UPDATE SET "lastValue" = "document_sequences"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"
  `;
  const value = rows[0]?.lastValue;
  if (value === undefined) throw new Error("Failed to allocate document number");
  return formatDocumentNumber(prefix, year, Number(value));
}
