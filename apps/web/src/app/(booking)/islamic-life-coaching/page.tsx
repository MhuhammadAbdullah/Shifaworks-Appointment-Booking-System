"use client";

import { islamicLifeCoachingBookingSchema, type IslamicLifeCoachingBookingInput } from "@booking/shared";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { IslamicLifeCoachingDetailsStep } from "@/components/booking/details/islamic-life-coaching-details";

export default function IslamicLifeCoachingPage() {
  return (
    <BookingWizard<IslamicLifeCoachingBookingInput>
      slug="islamic-life-coaching"
      title="Book Islamic Life Coaching"
      schema={islamicLifeCoachingBookingSchema}
      defaultValues={{
        service: "islamic-life-coaching",
        providerId: "",
        packageId: "",
        startsAt: "",
        personal: { firstName: "", phone: "", email: "" },
        location: { city: "" },
        details: { coachingAreas: { selected: [] }, goals: "" },
        termsAccepted: false,
        website: "",
      }}
      DetailsStep={IslamicLifeCoachingDetailsStep}
      detailsLabel="Session details"
    />
  );
}
