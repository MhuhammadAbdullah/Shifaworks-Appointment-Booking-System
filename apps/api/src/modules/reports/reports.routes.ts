import { Router } from "express";
import { reportQuerySchema, reportTypeParamSchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./reports.controller.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission("reports.view"));

reportsRouter.get("/:type", validate({ params: reportTypeParamSchema, query: reportQuerySchema }), controller.getReport);
reportsRouter.get("/:type/export", requirePermission("reports.export"), validate({ params: reportTypeParamSchema, query: reportQuerySchema }), controller.exportReportCsv);
