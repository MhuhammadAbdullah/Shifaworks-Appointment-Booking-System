import { Router } from "express";
import { idParamSchema, listPaymentsQuerySchema, markSubmittedSchema, refundPaymentSchema, rejectPaymentSchema, verifyPaymentSchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./payments.controller.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);
paymentsRouter.use(requirePermission("payments.view"));

paymentsRouter.get("/", validate({ query: listPaymentsQuerySchema }), controller.listPayments);
paymentsRouter.get("/export", validate({ query: listPaymentsQuerySchema }), controller.exportPaymentsCsv);
paymentsRouter.get("/:id", validate({ params: idParamSchema }), controller.getPayment);
paymentsRouter.delete("/:id", requirePermission("payments.delete"), validate({ params: idParamSchema }), controller.deletePayment);
paymentsRouter.post(
  "/:id/mark-submitted",
  requirePermission("payments.verify"),
  validate({ params: idParamSchema, body: markSubmittedSchema }),
  controller.markSubmitted,
);
paymentsRouter.post("/:id/verify", requirePermission("payments.verify"), validate({ params: idParamSchema, body: verifyPaymentSchema }), controller.verifyPayment);
paymentsRouter.post("/:id/reject", requirePermission("payments.verify"), validate({ params: idParamSchema, body: rejectPaymentSchema }), controller.rejectPayment);
paymentsRouter.post("/:id/refund", requirePermission("payments.refund"), validate({ params: idParamSchema, body: refundPaymentSchema }), controller.refundPayment);
