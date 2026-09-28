import { Router } from "express";
import { listAuditLogsQuerySchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./audit.controller.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission("audit.view"));

auditRouter.get("/", validate({ query: listAuditLogsQuerySchema }), controller.listAuditLogs);
auditRouter.get("/export", validate({ query: listAuditLogsQuerySchema }), controller.exportAuditLogsCsv);
