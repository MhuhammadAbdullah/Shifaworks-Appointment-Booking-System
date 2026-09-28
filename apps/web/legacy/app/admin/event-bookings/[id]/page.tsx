"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EventBookingDetail } from "@/components/events/event-booking-detail";

export default function AdminEventBookingPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <Link href="/admin/events" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" /> Events
      </Link>
      <EventBookingDetail id={id} audience="staff" />
    </>
  );
}
