"use client";

import { useParams } from "next/navigation";
import { BookingDetailView } from "@/components/bookings/booking-detail-view";

export default function ProviderAppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <BookingDetailView id={id} backHref="/provider/appointments" backLabel="My appointments" />;
}
