import type { RequestHandler } from "express";
import type { CreateInvoiceInput, CreatePayslipInput, InvoiceFromBookingInput, ListInvoicesQuery, VoidInvoiceInput } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import * as service from "./invoices.service.js";

type IdParams = { id: string };

export const listInvoices: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListInvoicesQuery>(req);
  const { items, ...meta } = await service.listInvoices(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const getInvoice: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.getInvoice(principalOf(req), params.id));
};

export const exportInvoicesCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListInvoicesQuery>(req);
  const csv = await service.exportInvoicesCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="invoices-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};

export const getInvoicePdf: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  const p = principalOf(req);
  const inv = await service.loadInvoice(prisma, p, params.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${inv.invoiceNumber}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  await renderInvoicePdf(inv, p.organizationId, res);
};

export const invoiceFromBooking: RequestHandler = async (req, res) => {
  const { body } = validated<InvoiceFromBookingInput>(req);
  sendCreated(res, await service.invoiceFromBooking(principalOf(req), body, auditContextFrom(req)), "Invoice raised");
};

export const createInvoice: RequestHandler = async (req, res) => {
  const { body } = validated<CreateInvoiceInput>(req);
  sendCreated(res, await service.createInvoice(principalOf(req), body, auditContextFrom(req)), "Invoice created");
};

export const createPayslip: RequestHandler = async (req, res) => {
  const { body } = validated<CreatePayslipInput>(req);
  sendCreated(res, await service.createPayslip(principalOf(req), body, auditContextFrom(req)), "Pay slip created");
};

export const issueInvoice: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.issueInvoice(principalOf(req), params.id, auditContextFrom(req)), "Invoice issued");
};

export const voidInvoice: RequestHandler = async (req, res) => {
  const { params, body } = validated<VoidInvoiceInput, unknown, IdParams>(req);
  sendOk(res, await service.voidInvoice(principalOf(req), params.id, body.reason, auditContextFrom(req)), "Invoice voided");
};
