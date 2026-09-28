export const DOCUMENT_PREFIXES = ["APT", "INV", "PAY", "TXN", "EXP", "CUS", "PSL"] as const;
export type DocumentPrefix = (typeof DOCUMENT_PREFIXES)[number];

const PATTERN = /^(APT|INV|PAY|TXN|EXP|CUS|PSL)-(\d{4})-(\d{6,})$/;

/** formatDocumentNumber("APT", 2026, 1) === "APT-2026-000001" */
export function formatDocumentNumber(prefix: DocumentPrefix, year: number, value: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`Invalid year: ${year}`);
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Invalid sequence value: ${value}`);
  }
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

export function parseDocumentNumber(
  input: string,
): { prefix: DocumentPrefix; year: number; value: number } | null {
  const match = PATTERN.exec(input);
  if (!match) return null;
  return {
    prefix: match[1] as DocumentPrefix,
    year: Number(match[2]),
    value: Number(match[3]),
  };
}
