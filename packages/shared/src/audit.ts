/**
 * Read side of the audit log (Phase 9). Every mutation across the app already
 * writes an AuditLog row via modules/audit/audit.service.ts's recordAudit —
 * this file is only the list/export contract for viewing them.
 */
import { z } from "zod";
import { paginationQuerySchema } from "./validation.js";

const isoDate = z.iso.date("Use YYYY-MM-DD");

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  user: { id: string; name: string } | null;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  userId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
