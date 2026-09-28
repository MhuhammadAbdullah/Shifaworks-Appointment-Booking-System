/**
 * CSV for spreadsheets: RFC 4180 quoting, CRLF, UTF-8 BOM (so Excel reads
 * Urdu/accents correctly) and formula-injection protection: a text cell that
 * starts with = + - @ tab or CR is prefixed with ' so it is never evaluated.
 * Plain numbers (including negatives like -250.00) are left as numbers.
 */
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const safe = !NUMBER.test(s) && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
