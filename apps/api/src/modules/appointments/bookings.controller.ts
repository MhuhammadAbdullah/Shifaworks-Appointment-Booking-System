import type { RequestHandler } from "express";
import type {
  CancelBookingInput,
  ListBookingsQuery,
  ManualBookingInput,
  RescheduleBookingInput,
  UpdateBookingDetailsInput,
  UpdateBookingNotesInput,
} from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./bookings.service.js";

type IdParams = { id: string };

export const listBookings: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListBookingsQuery>(req);
  const { items, ...meta } = await service.listBookings(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const exportBookingsCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListBookingsQuery>(req);
  const csv = await service.exportBookingsCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bookings-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};

export const getBooking: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.getBooking(principalOf(req), params.id));
};

export const createManualBooking: RequestHandler = async (req, res) => {
  const { body } = validated<ManualBookingInput>(req);
  const booking = await service.createManualBooking(principalOf(req), body, auditContextFrom(req));
  sendCreated(res, booking, `Booked ${booking.bookingNumber}`);
};

export const updateNotes: RequestHandler = async (req, res) => {
  const { params, body } = validated<UpdateBookingNotesInput, unknown, IdParams>(req);
  sendOk(res, await service.updateBookingNotes(principalOf(req), params.id, body, auditContextFrom(req)), "Notes saved");
};

export const updateDetails: RequestHandler = async (req, res) => {
  const { params, body } = validated<UpdateBookingDetailsInput, unknown, IdParams>(req);
  sendOk(res, await service.updateBookingDetails(principalOf(req), params.id, body, auditContextFrom(req)), "Details saved");
};

export const deleteBooking: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await service.deleteBooking(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
};

export const cancelBooking: RequestHandler = async (req, res) => {
  const { params, body } = validated<CancelBookingInput, unknown, IdParams>(req);
  sendOk(res, await service.cancelBooking(principalOf(req), params.id, body, auditContextFrom(req)), "Booking cancelled");
};

export const rescheduleBooking: RequestHandler = async (req, res) => {
  const { params, body } = validated<RescheduleBookingInput, unknown, IdParams>(req);
  sendOk(res, await service.rescheduleBooking(principalOf(req), params.id, body, auditContextFrom(req)), "Booking rescheduled");
};

export const confirmBooking: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.confirmBooking(principalOf(req), params.id, auditContextFrom(req)), "Booking confirmed");
};

export const completeBooking: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.completeBooking(principalOf(req), params.id, auditContextFrom(req)), "Marked completed");
};

export const markNoShow: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.markNoShow(principalOf(req), params.id, auditContextFrom(req)), "Marked no-show");
};

export const resendConfirmation: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.resendConfirmation(principalOf(req), params.id, auditContextFrom(req)), "Confirmation email re-sent");
};
