"use client";

import { speechTherapyBookingSchema, type SpeechTherapyBookingInput } from "@booking/shared";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { SpeechTherapyDetailsStep } from "@/components/booking/details/speech-therapy-details";

export default function SpeechTherapyPage() {
  return (
    <BookingWizard<SpeechTherapyBookingInput>
      slug="speech-therapy"
      title="Book Speech Therapy"
      schema={speechTherapyBookingSchema}
      defaultValues={{
        service: "speech-therapy",
        providerId: "",
        packageId: "",
        startsAt: "",
        personal: { firstName: "", phone: "", email: "" },
        location: { city: "" },
        details: { concerns: { selected: [] } },
        termsAccepted: false,
        website: "",
      }}
      DetailsStep={SpeechTherapyDetailsStep}
      detailsLabel="Session details"
    />
  );
}
