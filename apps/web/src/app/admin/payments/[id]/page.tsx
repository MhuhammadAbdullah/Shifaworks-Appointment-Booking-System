"use client";

import { useParams } from "next/navigation";
import { PaymentDetailView } from "@/components/payments/payment-detail-view";

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PaymentDetailView id={id} backHref="/admin/payments" backLabel="Payments" />;
}
