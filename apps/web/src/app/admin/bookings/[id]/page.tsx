"use client";

import { useParams } from "next/navigation";
import { BookingDetailView } from "@/components/bookings/booking-detail-view";

export default function AdminBookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <BookingDetailView id={id} backHref="/admin/bookings" backLabel="Bookings" />;
}
