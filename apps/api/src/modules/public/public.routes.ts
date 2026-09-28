import { Router } from "express";
import multer from "multer";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { publicAvailableDatesQuerySchema, publicProvidersQuerySchema, publicSlotsQuerySchema, type ApiFailure } from "@booking/shared";
import { env } from "../../config/env.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./public.controller.js";

/**
 * Unauthenticated endpoints the five booking forms use. No `requireAuth`
 * anywhere in this router — everything here is meant for anonymous visitors,
 * and every write is covered by its own strict rate limit on top of the
 * global /api ceiling (see app.ts).
 */
export const publicRouter = Router();

publicRouter.get("/branding", controller.getBranding);
publicRouter.get("/services/:slug", controller.getService);
publicRouter.get("/providers", validate({ query: publicProvidersQuerySchema }), controller.listProviders);
publicRouter.get("/availability/dates", validate({ query: publicAvailableDatesQuerySchema }), controller.availableDates);
publicRouter.get("/availability/slots", validate({ query: publicSlotsQuerySchema }), controller.slots);

// Spam / abuse protection for submissions specifically (settings-configurable elsewhere via env).
const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.PUBLIC_BOOKING_LIMIT_PER_HOUR,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  handler: (_req, res) => {
    const body: ApiFailure = { success: false, code: "RATE_LIMITED", message: "Too many booking attempts. Please try again later." };
    res.status(429).json(body);
  },
});

publicRouter.post("/bookings", bookingLimiter, controller.createBooking);

// Receipt upload: its own limiter (uploads are heavier than a form submit but
// still abuse-prone), memory storage, magic-byte sniffed in files.service.ts —
// never trust the client's declared Content-Type.
const receiptLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.PUBLIC_BOOKING_LIMIT_PER_HOUR,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  handler: (_req, res) => {
    const body: ApiFailure = { success: false, code: "RATE_LIMITED", message: "Too many uploads. Please try again later." };
    res.status(429).json(body);
  },
});
const uploadReceipt = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } });
publicRouter.post("/bookings/receipt", receiptLimiter, uploadReceipt.single("file"), controller.uploadReceipt);
