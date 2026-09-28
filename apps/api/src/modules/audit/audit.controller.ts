import type { RequestHandler } from "express";
import type { ListAuditLogsQuery } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendPaginated } from "../../utils/api-response.js";
import * as audit from "./audit.service.js";

export const listAuditLogs: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListAuditLogsQuery>(req);
  const { items, ...meta } = await audit.listAuditLogs(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const exportAuditLogsCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListAuditLogsQuery>(req);
  const csv = await audit.exportAuditLogsCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};
