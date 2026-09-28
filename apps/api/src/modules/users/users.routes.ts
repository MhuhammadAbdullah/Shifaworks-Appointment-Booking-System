import { Router } from "express";
import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  setUserPermissionsSchema,
  setUserRolesSchema,
  setUserStatusSchema,
  updateUserSchema,
} from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./users.controller.js";

/**
 * Staff and provider accounts (customers have none). Route guards are the
 * coarse gate; the service applies the fine-grained rules (self-management,
 * escalation, last super admin).
 */
export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/", requirePermission("staff.view"), validate({ query: listUsersQuerySchema }), controller.listUsers);
usersRouter.post("/", requirePermission("staff.create"), validate({ body: createUserSchema }), controller.createUser);
usersRouter.get("/:id", requirePermission("staff.view"), validate({ params: idParamSchema }), controller.getUser);
usersRouter.patch(
  "/:id",
  requirePermission("staff.update"),
  validate({ params: idParamSchema, body: updateUserSchema }),
  controller.updateUser,
);
usersRouter.put(
  "/:id/status",
  requirePermission("staff.update"),
  validate({ params: idParamSchema, body: setUserStatusSchema }),
  controller.setStatus,
);
usersRouter.put(
  "/:id/roles",
  requirePermission("staff.update"),
  validate({ params: idParamSchema, body: setUserRolesSchema }),
  controller.setRoles,
);
usersRouter.put(
  "/:id/permissions",
  requirePermission("roles.manage"),
  validate({ params: idParamSchema, body: setUserPermissionsSchema }),
  controller.setPermissions,
);
usersRouter.post("/:id/invite", requirePermission("staff.create"), validate({ params: idParamSchema }), controller.sendInvite);
usersRouter.delete("/:id", requirePermission("staff.delete"), validate({ params: idParamSchema }), controller.deleteUser);
