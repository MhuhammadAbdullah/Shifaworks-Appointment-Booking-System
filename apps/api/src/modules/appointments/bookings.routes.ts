import { Router } from "express";
import {
  cancelBookingSchema,
  idParamSchema,
  listBookingsQuerySchema,
  manualBookingSchema,
  rescheduleBookingSchema,
  updateBookingDetailsSchema,
  updateBookingNotesSchema,
} from "@booking/shared";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./bookings.controller.js";

/**
 * Route guards are the coarse gate; the service scopes every read and write
 * to what the caller may see (staff with bookings.view_all vs. a provider's
 * own appointments) and re-checks permissions for cancel/reschedule.
 */
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const canView = requireAnyPermission("bookings.view", "bookings.view_all");

bookingsRouter.get("/", canView, validate({ query: listBookingsQuerySchema }), controller.listBookings);
bookingsRouter.get("/export", canView, validate({ query: listBookingsQuerySchema }), controller.exportBookingsCsv);
bookingsRouter.post("/manual", requirePermission("bookings.create"), validate({ body: manualBookingSchema }), controller.createManualBooking);
bookingsRouter.get("/:id", canView, validate({ params: idParamSchema }), controller.getBooking);
bookingsRouter.patch(
  "/:id/notes",
  requirePermission("bookings.update"),
  validate({ params: idParamSchema, body: updateBookingNotesSchema }),
  controller.updateNotes,
);
bookingsRouter.patch(
  "/:id",
  requirePermission("bookings.update"),
  validate({ params: idParamSchema, body: updateBookingDetailsSchema }),
  controller.updateDetails,
);
bookingsRouter.delete("/:id", requirePermission("bookings.delete"), validate({ params: idParamSchema }), controller.deleteBooking);
bookingsRouter.post("/:id/cancel", requirePermission("bookings.cancel"), validate({ params: idParamSchema, body: cancelBookingSchema }), controller.cancelBooking);
bookingsRouter.post(
  "/:id/reschedule",
  requirePermission("bookings.update"),
  validate({ params: idParamSchema, body: rescheduleBookingSchema }),
  controller.rescheduleBooking,
);
bookingsRouter.post("/:id/confirm", requirePermission("bookings.update"), validate({ params: idParamSchema }), controller.confirmBooking);
bookingsRouter.post("/:id/complete", requirePermission("bookings.update"), validate({ params: idParamSchema }), controller.completeBooking);
bookingsRouter.post("/:id/no-show", requirePermission("bookings.update"), validate({ params: idParamSchema }), controller.markNoShow);
bookingsRouter.post(
  "/:id/resend-confirmation",
  requirePermission("bookings.update"),
  validate({ params: idParamSchema }),
  controller.resendConfirmation,
);
