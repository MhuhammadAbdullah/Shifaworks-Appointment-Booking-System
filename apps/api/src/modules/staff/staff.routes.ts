import { Router } from "express";
import { z } from "zod";
import {
  listStaffQuerySchema,
  updateStaffProfileSchema,
  type ListStaffQuery,
  type UpdateStaffProfileInput,
} from "@booking/shared";
import { principalOf, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./staff.service.js";

/**
 * Staff accounts (invite, roles, status) are managed through /users; this
 * module holds employment details (employee code, department, joining date,
 * primary location). Routes are keyed by userId.
 */
export const staffRouter = Router();
staffRouter.use(requireAuth);

const userIdParams = z.object({ userId: z.uuid() });
type UserIdParams = z.infer<typeof userIdParams>;

staffRouter.get("/", requirePermission("staff.view"), validate({ query: listStaffQuerySchema }), async (req, res) => {
  const { query } = validated<unknown, ListStaffQuery>(req);
  const { items, ...meta } = await service.listStaff(principalOf(req), query);
  sendPaginated(res, items, meta);
});

staffRouter.get("/:userId", requirePermission("staff.view"), validate({ params: userIdParams }), async (req, res) => {
  const { params } = validated<unknown, unknown, UserIdParams>(req);
  sendOk(res, await service.getStaff(principalOf(req), params.userId));
});

staffRouter.patch(
  "/:userId",
  requirePermission("staff.update"),
  validate({ params: userIdParams, body: updateStaffProfileSchema }),
  async (req, res) => {
    const { body, params } = validated<UpdateStaffProfileInput, unknown, UserIdParams>(req);
    sendOk(
      res,
      await service.updateStaffProfile(principalOf(req), params.userId, body, auditContextFrom(req)),
      "Employment details updated",
    );
  },
);
