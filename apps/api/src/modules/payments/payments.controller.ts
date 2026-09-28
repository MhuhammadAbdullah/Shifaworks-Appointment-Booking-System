import type { RequestHandler } from "express";
import type { ListPaymentsQuery, MarkSubmittedInput, RefundPaymentInput, RejectPaymentInput, VerifyPaymentInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendNoContent, sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./payments.service.js";

type IdParams = { id: string };

export const listPayments: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListPaymentsQuery>(req);
  const { items, ...meta } = await service.listPayments(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const getPayment: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  res.setHeader("Cache-Control", "no-store");
  sendOk(res, await service.getPayment(principalOf(req), params.id));
};

export const deletePayment: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await service.deletePayment(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
};

export const exportPaymentsCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListPaymentsQuery>(req);
  const csv = await service.exportPaymentsCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="payments-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};

export const markSubmitted: RequestHandler = async (req, res) => {
  const { params, body } = validated<MarkSubmittedInput, unknown, IdParams>(req);
  sendOk(res, await service.markSubmitted(principalOf(req), params.id, body, auditContextFrom(req)), "Marked as submitted");
};

export const verifyPayment: RequestHandler = async (req, res) => {
  const { params, body } = validated<VerifyPaymentInput, unknown, IdParams>(req);
  sendOk(res, await service.verifyPayment(principalOf(req), params.id, body, auditContextFrom(req)), "Payment verified");
};

export const rejectPayment: RequestHandler = async (req, res) => {
  const { params, body } = validated<RejectPaymentInput, unknown, IdParams>(req);
  sendOk(res, await service.rejectPayment(principalOf(req), params.id, body, auditContextFrom(req)), "Payment rejected");
};

export const refundPayment: RequestHandler = async (req, res) => {
  const { params, body } = validated<RefundPaymentInput, unknown, IdParams>(req);
  sendOk(res, await service.refundPayment(principalOf(req), params.id, body, auditContextFrom(req)), "Refund recorded");
};
