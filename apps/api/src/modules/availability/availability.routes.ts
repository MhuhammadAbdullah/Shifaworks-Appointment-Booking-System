import { Router, type Request } from "express";
import { z } from "zod";
import {
  availableDatesQuerySchema,
  bulkCreateExceptionsSchema,
  createBlockedSlotSchema,
  createExceptionSchema,
  createHolidaySchema,
  idParamSchema,
  slotsQuerySchema,
  weeklyScheduleSchema,
  type AvailableDatesQuery,
  type BulkCreateExceptionsInput,
  type CreateBlockedSlotInput,
  type CreateExceptionInput,
  type CreateHolidayInput,
  type SlotsQuery,
  type WeeklyScheduleInput,
} from "@booking/shared";
import { principalOf, requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { hasPermission } from "../auth/permission-rules.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./availability.service.js";

/**
 * Staff and provider availability management. The public, rate-limited
 * /availability/dates and /availability/slots used by the booking forms are
 * mounted separately (Phase 4) on the same service functions.
 */
export const availabilityRouter = Router();
availabilityRouter.use(requireAuth);

const providerParams = z.object({ providerId: z.uuid() });
const childParams = providerParams.extend({ id: z.uuid() });
type ProviderParams = z.infer<typeof providerParams>;
type ChildParams = z.infer<typeof childParams>;

/** "me" resolves to the signed-in provider's profile. */
availabilityRouter.param("providerId", (req, _res, next, value: string) => {
  if (value === "me") {
    const id = principalOf(req).providerProfileId;
    if (!id) throw AppError.forbidden("Only therapists and counsellors have availability");
    req.params.providerId = id;
  }
  next();
});

// --- staff slot preview (same engine as the public form; no notice limit) ------------
const previewGuard = requireAnyPermission("bookings.create", "availability.manage_all", "availability.view");

/** Providers may only preview their own calendar. */
function assertPreviewScope(req: Request, providerId: string) {
  const p = principalOf(req);
  if (p.staffProfileId || hasPermission(p, "availability.manage_all") || p.providerProfileId === providerId) return;
  throw AppError.forbidden();
}

function org(req: Request) {
  const p = principalOf(req);
  return { id: p.organizationId, timezone: p.organization.timezone };
}

availabilityRouter.get("/preview/dates", previewGuard, validate({ query: availableDatesQuerySchema }), async (req, res) => {
  const { query } = validated<unknown, AvailableDatesQuery>(req);
  assertPreviewScope(req, query.providerId);
  sendOk(res, await service.availableDates(org(req), query, { online: false }));
});

availabilityRouter.get("/preview/slots", previewGuard, validate({ query: slotsQuerySchema }), async (req, res) => {
  const { query } = validated<unknown, SlotsQuery>(req);
  assertPreviewScope(req, query.providerId);
  sendOk(res, await service.slotsForDate(org(req), query, { online: false }));
});

// --- holidays (clinic-wide) --------------------------------------------------------
availabilityRouter.get("/holidays", async (req, res) => {
  sendOk(res, await service.listHolidays(principalOf(req)));
});
availabilityRouter.post(
  "/holidays",
  requirePermission("availability.manage_all"),
  validate({ body: createHolidaySchema }),
  async (req, res) => {
    const { body } = validated<CreateHolidayInput>(req);
    sendOk(res, await service.createHoliday(principalOf(req), body, auditContextFrom(req)), "Holiday added");
  },
);
availabilityRouter.delete(
  "/holidays/:id",
  requirePermission("availability.manage_all"),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const { params } = validated<unknown, unknown, { id: string }>(req);
    sendOk(res, await service.deleteHoliday(principalOf(req), params.id, auditContextFrom(req)), "Holiday removed");
  },
);

// --- provider availability (ownership checks in the service) -------------------------
availabilityRouter.get("/providers/:providerId", validate({ params: providerParams }), async (req, res) => {
  const { params } = validated<unknown, unknown, ProviderParams>(req);
  sendOk(res, await service.getAvailability(principalOf(req), params.providerId));
});

availabilityRouter.put(
  "/providers/:providerId/schedule",
  validate({ params: providerParams, body: weeklyScheduleSchema }),
  async (req, res) => {
    const { params, body } = validated<WeeklyScheduleInput, unknown, ProviderParams>(req);
    sendOk(res, await service.setWeeklySchedule(principalOf(req), params.providerId, body, auditContextFrom(req)), "Weekly hours saved");
  },
);

availabilityRouter.post(
  "/providers/:providerId/exceptions",
  validate({ params: providerParams, body: createExceptionSchema }),
  async (req, res) => {
    const { params, body } = validated<CreateExceptionInput, unknown, ProviderParams>(req);
    sendOk(res, await service.createException(principalOf(req), params.providerId, body, auditContextFrom(req)), "Dates saved");
  },
);

availabilityRouter.delete("/providers/:providerId/exceptions/:id", validate({ params: childParams }), async (req, res) => {
  const { params } = validated<unknown, unknown, ChildParams>(req);
  sendOk(res, await service.deleteException(principalOf(req), params.providerId, params.id, auditContextFrom(req)), "Removed");
});

/** Save several single-date exceptions at once — the calendar multi-select flow ("pick dates, set hours per date"). */
availabilityRouter.post(
  "/providers/:providerId/exceptions/bulk",
  validate({ params: providerParams, body: bulkCreateExceptionsSchema }),
  async (req, res) => {
    const { params, body } = validated<BulkCreateExceptionsInput, unknown, ProviderParams>(req);
    sendOk(res, await service.bulkCreateExceptions(principalOf(req), params.providerId, body, auditContextFrom(req)), "Dates saved");
  },
);

availabilityRouter.post(
  "/providers/:providerId/blocks",
  validate({ params: providerParams, body: createBlockedSlotSchema }),
  async (req, res) => {
    const { params, body } = validated<CreateBlockedSlotInput, unknown, ProviderParams>(req);
    sendOk(res, await service.createBlockedSlot(principalOf(req), params.providerId, body, auditContextFrom(req)), "Time blocked");
  },
);

availabilityRouter.delete("/providers/:providerId/blocks/:id", validate({ params: childParams }), async (req, res) => {
  const { params } = validated<unknown, unknown, ChildParams>(req);
  sendOk(res, await service.deleteBlockedSlot(principalOf(req), params.providerId, params.id, auditContextFrom(req)), "Block removed");
});
