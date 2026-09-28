"use client";

import { faithBasedCounselingBookingSchema, type FaithBasedCounselingBookingInput } from "@booking/shared";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { FaithBasedCounselingDetailsStep } from "@/components/booking/details/faith-based-counseling-details";

export default function FaithBasedCounselingPage() {
  return (
    <BookingWizard<FaithBasedCounselingBookingInput>
      slug="faith-based-counseling"
      title="Book Faith-Based Counseling"
      schema={faithBasedCounselingBookingSchema}
      defaultValues={{
        service: "faith-based-counseling",
        providerId: "",
        packageId: "",
        startsAt: "",
        personal: { firstName: "", phone: "", email: "" },
        location: { city: "" },
        details: { areasOfConcern: { selected: [] } },
        termsAccepted: false,
        website: "",
      }}
      DetailsStep={FaithBasedCounselingDetailsStep}
      detailsLabel="Session details"
    />
  );
}
