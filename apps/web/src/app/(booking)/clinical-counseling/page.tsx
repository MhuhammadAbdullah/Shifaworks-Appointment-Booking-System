"use client";

import { clinicalCounselingBookingSchema, type ClinicalCounselingBookingInput } from "@booking/shared";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { ClinicalCounselingDetailsStep } from "@/components/booking/details/clinical-counseling-details";

export default function ClinicalCounselingPage() {
  return (
    <BookingWizard<ClinicalCounselingBookingInput>
      slug="clinical-counseling"
      title="Book Clinical Counseling"
      schema={clinicalCounselingBookingSchema}
      defaultValues={{
        service: "clinical-counseling",
        providerId: "",
        packageId: "",
        startsAt: "",
        personal: { firstName: "", phone: "", email: "" },
        location: { city: "" },
        details: { areasOfConcern: { selected: [] }, emergencyContactName: "", emergencyContactPhone: "" },
        termsAccepted: false,
        website: "",
      }}
      DetailsStep={ClinicalCounselingDetailsStep}
      detailsLabel="Session details"
    />
  );
}
