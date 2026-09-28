import type { RequestHandler } from "express";
import type { ReportQuery, ReportType } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import * as reports from "./reports.service.js";

type TypeParams = { type: ReportType };

export const getReport: RequestHandler = async (req, res) => {
  const { params, query } = validated<unknown, ReportQuery, TypeParams>(req);
  sendOk(res, await reports.getReport(principalOf(req), params.type, query));
};

export const exportReportCsv: RequestHandler = async (req, res) => {
  const { params, query } = validated<unknown, ReportQuery, TypeParams>(req);
  const csv = await reports.exportReportCsv(principalOf(req), params.type, query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${params.type}-report-${query.from}-${query.to}.csv"`);
  res.send(csv);
};
