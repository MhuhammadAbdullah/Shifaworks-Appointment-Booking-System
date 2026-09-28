"use client";

import { hijamaBookingSchema, type HijamaBookingInput } from "@booking/shared";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { HijamaTherapyDetailsStep } from "@/components/booking/details/hijama-therapy-details";

export default function HijamaTherapyPage() {
  return (
    <BookingWizard<HijamaBookingInput>
      slug="hijama-therapy"
      title="Book Hijama Therapy"
      schema={hijamaBookingSchema}
      defaultValues={{
        service: "hijama-therapy",
        providerId: "",
        packageId: "",
        startsAt: "",
        personal: { firstName: "", phone: "", email: "" },
        location: { city: "" },
        details: {},
        termsAccepted: false,
        website: "",
      }}
      DetailsStep={HijamaTherapyDetailsStep}
      detailsLabel="Health information"
    />
  );
}
