import { z } from "zod";
import { optionalText } from "../validation.js";
import { bookingSchema } from "./common.js";

// In-clinic only: no delivery mode or language questions.
export const hijamaDetailsSchema = z.object({
  medicalNotes: optionalText(1000),
});
export type HijamaDetailsInput = z.infer<typeof hijamaDetailsSchema>;

export const hijamaBookingSchema = bookingSchema("hijama-therapy", hijamaDetailsSchema);
export type HijamaBookingInput = z.infer<typeof hijamaBookingSchema>;
