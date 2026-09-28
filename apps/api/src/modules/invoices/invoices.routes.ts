import { Router } from "express";
import { createInvoiceSchema, createPayslipSchema, idParamSchema, invoiceFromBookingSchema, listInvoicesQuerySchema, voidInvoiceSchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./invoices.controller.js";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);
invoicesRouter.use(requirePermission("invoices.view"));

invoicesRouter.get("/", validate({ query: listInvoicesQuerySchema }), controller.listInvoices);
invoicesRouter.get("/export", validate({ query: listInvoicesQuerySchema }), controller.exportInvoicesCsv);
invoicesRouter.post("/from-booking", requirePermission("invoices.create"), validate({ body: invoiceFromBookingSchema }), controller.invoiceFromBooking);
invoicesRouter.post("/", requirePermission("invoices.create"), validate({ body: createInvoiceSchema }), controller.createInvoice);
invoicesRouter.post("/for-provider", requirePermission("invoices.create"), validate({ body: createPayslipSchema }), controller.createPayslip);
invoicesRouter.get("/:id", validate({ params: idParamSchema }), controller.getInvoice);
invoicesRouter.get("/:id/pdf", validate({ params: idParamSchema }), controller.getInvoicePdf);
invoicesRouter.post("/:id/issue", requirePermission("invoices.update"), validate({ params: idParamSchema }), controller.issueInvoice);
invoicesRouter.post("/:id/void", requirePermission("invoices.void"), validate({ params: idParamSchema, body: voidInvoiceSchema }), controller.voidInvoice);
