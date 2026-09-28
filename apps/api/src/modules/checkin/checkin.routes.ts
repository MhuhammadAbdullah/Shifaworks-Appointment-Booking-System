import { Router } from "express";
import { z } from "zod";
import { checkInLookupQuerySchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./checkin.controller.js";

const appointmentIdParamSchema = z.object({ appointmentId: z.uuid() });

export const checkinRouter = Router();
checkinRouter.use(requireAuth, requirePermission("bookings.check_in"));

checkinRouter.get("/lookup", validate({ query: checkInLookupQuerySchema }), controller.lookup);
checkinRouter.post("/:appointmentId", validate({ params: appointmentIdParamSchema }), controller.checkIn);
checkinRouter.post("/:appointmentId/reset", validate({ params: appointmentIdParamSchema }), controller.reset);
