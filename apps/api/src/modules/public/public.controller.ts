import type { RequestHandler } from "express";
import type { PublicAvailableDatesQuery, PublicProvidersQuery, PublicSlotsQuery } from "@booking/shared";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import * as service from "./public.service.js";

export const getBranding: RequestHandler = async (_req, res) => {
  sendOk(res, await service.getBranding());
};

export const getService: RequestHandler = async (req, res) => {
  // Not run through validate() (see public.routes.ts): an unknown slug should
  // read as 404, not 422, so the service layer checks it via isServiceSlug().
  sendOk(res, await service.getServiceBootstrap(String(req.params.slug)));
};

export const listProviders: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, PublicProvidersQuery>(req);
  sendOk(res, await service.listPublicProviders(query.service, query.gender));
};

export const availableDates: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, PublicAvailableDatesQuery>(req);
  sendOk(res, await service.publicAvailableDates(query));
};

export const slots: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, PublicSlotsQuery>(req);
  sendOk(res, await service.publicSlots(query));
};

export const createBooking: RequestHandler = async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
  const result = await service.submitPublicBooking(req.body, idempotencyKey);
  sendCreated(res, result, `Booking request received - ${result.bookingNumber}`);
};

export const uploadReceipt: RequestHandler = async (req, res) => {
  if (!req.file) throw AppError.badRequest('Attach the receipt in a form field named "file"');
  const ctx = { ipAddress: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 500) ?? null, requestId: req.id ? String(req.id) : null };
  sendCreated(res, await service.uploadPublicReceipt(req.file, ctx), "Receipt uploaded");
};
