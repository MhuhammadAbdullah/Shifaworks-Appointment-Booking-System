"use client";

import { useParams } from "next/navigation";
import { InvoiceDetailView } from "@/components/invoices/invoice-detail-view";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceDetailView id={id} backHref="/admin/invoices" />;
}
