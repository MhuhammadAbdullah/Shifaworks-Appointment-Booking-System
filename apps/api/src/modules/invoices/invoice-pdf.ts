import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { PAYMENT_METHOD_LABELS, PROVIDER_TYPE_LABELS } from "@booking/shared";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { getOrgSettings } from "../../lib/settings.js";
import { fileUrlSelect, publicFileUrl } from "../files/files.service.js";
import type { InvoiceRow } from "./invoices.service.js";

const fmt = (currency: string) => (v: { toFixed(n: number): string } | string) =>
  `${currency} ${Number(typeof v === "string" ? v : v.toFixed(2)).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Renders an A4 invoice PDF into `out` (e.g. the HTTP response). Uses PDF core fonts only. */
export async function renderInvoicePdf(inv: InvoiceRow, organizationId: string, out: Writable): Promise<void> {
  const [org, settings] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, email: true, phone: true, website: true, logo: fileUrlSelect } }),
    getOrgSettings(organizationId),
  ]);
  const footer = settings.invoiceFooter;
  const money = fmt(inv.currency);
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${inv.invoiceNumber}`, Author: org.name } });
  doc.pipe(out);

  const muted = "#6b7280";
  const left = 50;
  const right = 545;

  // Header — logo (if one is set in Settings) to the left, name/contact beside it.
  let textLeft = left;
  const logoUrl = publicFileUrl(org.logo);
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        doc.image(Buffer.from(await res.arrayBuffer()), left, 45, { fit: [50, 50] });
        textLeft = left + 62;
      }
    } catch (err) {
      logger.warn({ err }, "could not embed organisation logo in invoice PDF");
    }
  }
  doc.fontSize(18).font("Helvetica-Bold").fillColor("#111827").text(org.name, textLeft, 50);
  doc.fontSize(9).font("Helvetica").fillColor(muted);
  const orgLines = [[org.phone, org.email].filter(Boolean).join(" · "), org.website].filter(Boolean) as string[];
  for (const l of orgLines) doc.text(l, textLeft);

  const isPayslip = inv.audience === "PROVIDER";
  const docTitle = isPayslip ? "PAY SLIP" : "INVOICE";
  doc.fontSize(22).font("Helvetica-Bold").fillColor("#0f766e").text(inv.status === "VOID" ? `${docTitle} (VOID)` : docTitle, left, 50, { align: "right", width: right - left });
  doc.fontSize(10).font("Helvetica").fillColor("#111827");
  const meta: [string, string][] = [
    [isPayslip ? "Pay-slip no." : "Invoice no.", inv.invoiceNumber],
    ["Issue date", inv.issueDate.toISOString().slice(0, 10)],
    ...(inv.dueDate ? ([["Due date", inv.dueDate.toISOString().slice(0, 10)]] as [string, string][]) : []),
    ...(inv.booking ? ([["Booking", inv.booking.bookingNumber]] as [string, string][]) : []),
    ["Status", inv.status.replace("_", " ")],
  ];
  let y = 82;
  for (const [k, v] of meta) {
    doc.fillColor(muted).text(k, 360, y, { width: 80 }).fillColor("#111827").text(v, 440, y, { width: 105, align: "right" });
    y += 14;
  }

  // Bill to (customer) / Paid to (provider)
  y = Math.max(y, doc.y) + 20;
  doc.fontSize(9).fillColor(muted).text(isPayslip ? "PAID TO" : "BILL TO", left, y);
  doc.fontSize(9).font("Helvetica").fillColor(muted);
  if (isPayslip && inv.provider) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#111827").text(inv.provider.displayName, left, y + 12);
    doc.fontSize(9).font("Helvetica").fillColor(muted);
    for (const l of [PROVIDER_TYPE_LABELS[inv.provider.providerType]]) doc.text(l);
  } else if (inv.customer) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#111827").text([inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(" "), left, y + 12);
    doc.fontSize(9).font("Helvetica").fillColor(muted);
    for (const l of [inv.customer.customerNumber, inv.customer.email, inv.customer.phone].filter(Boolean) as string[]) doc.text(l);
  }

  // Items table — no Qty column: every line is one service/charge, never a product count.
  y = doc.y + 20;
  const descWidth = 300;
  const cols = { desc: left, price: 360, tax: 430, total: 480 };
  doc.rect(left, y, right - left, 20).fill("#f3f4f6");
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#111827");
  doc.text("Description", cols.desc + 6, y + 6);
  doc.text("Price", cols.price, y + 6, { width: 65, align: "right" }).text("Tax", cols.tax, y + 6, { width: 45, align: "right" });
  doc.text("Amount", cols.total, y + 6, { width: right - cols.total - 6, align: "right" });
  y += 26;
  doc.font("Helvetica").fontSize(9);
  for (const it of inv.items) {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    const h = Math.max(doc.heightOfString(it.description, { width: descWidth }), 12);
    doc.fillColor("#111827").text(it.description, cols.desc + 6, y, { width: descWidth });
    doc.text(it.unitPrice.toFixed(2), cols.price, y, { width: 65, align: "right" });
    doc.text(it.taxAmount.gt(0) ? it.taxAmount.toFixed(2) : "-", cols.tax, y, { width: 45, align: "right" });
    doc.text(it.totalAmount.toFixed(2), cols.total, y, { width: right - cols.total - 6, align: "right" });
    y += h + 8;
    if (it.discountAmount.gt(0)) {
      doc.fillColor(muted).text(`Discount −${it.discountAmount.toFixed(2)}`, cols.desc + 6, y - 6, { width: descWidth });
      y += 8;
    }
    doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor("#e5e7eb").stroke();
  }

  // Totals
  y += 8;
  const totals: [string, string, boolean][] = [
    ["Subtotal", money(inv.subtotal), false],
    ...(inv.discountAmount.gt(0) ? ([["Discount", `−${money(inv.discountAmount)}`, false]] as [string, string, boolean][]) : []),
    ...(inv.taxAmount.gt(0) ? ([["Tax", money(inv.taxAmount), false]] as [string, string, boolean][]) : []),
    ["Total", money(inv.totalAmount), true],
    ["Paid", money(inv.amountPaid), false],
    ["Balance due", money(inv.amountDue), true],
  ];
  for (const [k, v, bold] of totals) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor("#111827");
    doc.text(k, 360, y, { width: 90 }).text(v, 440, y, { width: 105, align: "right" });
    y += bold ? 18 : 15;
  }

  // Payments
  if (inv.payments.length) {
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10).text("Payments received", left, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(muted);
    for (const p of inv.payments) {
      const net = p.amount.minus(p.refundedAmount);
      doc.text(
        `${p.verifiedAt?.toISOString().slice(0, 10) ?? ""}  ${p.paymentNumber}  ${p.method ? PAYMENT_METHOD_LABELS[p.method] : ""}${p.refundedAmount.gt(0) ? ` (refunded ${p.refundedAmount.toFixed(2)})` : ""}`,
        left,
        y,
      );
      doc.text(money(net), 440, y, { width: 105, align: "right" });
      y += 13;
    }
  }

  if (inv.notes) {
    y += 14;
    doc.fillColor(muted).fontSize(9).text(inv.notes, left, y, { width: right - left });
  }
  const footerText = footer.trim() || "Thank you.";
  doc.fontSize(8).fillColor(muted).text(footerText, left, 780, { width: right - left, align: "center" });
  doc.end();
}
