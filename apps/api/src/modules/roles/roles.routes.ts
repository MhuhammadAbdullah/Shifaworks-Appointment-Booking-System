import { Router } from "express";
import { createRoleSchema, idParamSchema, updateRoleSchema } from "@booking/shared";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./roles.controller.js";

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

// Anyone who assigns roles to users needs to see the role list.
rolesRouter.get("/", requireAnyPermission("roles.view", "staff.create", "staff.update"), controller.listRoles);
rolesRouter.post("/", requirePermission("roles.manage"), validate({ body: createRoleSchema }), controller.createRole);
rolesRouter.patch(
  "/:id",
  requirePermission("roles.manage"),
  validate({ params: idParamSchema, body: updateRoleSchema }),
  controller.updateRole,
);
rolesRouter.delete("/:id", requirePermission("roles.manage"), validate({ params: idParamSchema }), controller.deleteRole);

export const permissionsRouter = Router();
permissionsRouter.use(requireAuth);
permissionsRouter.get("/", requirePermission("roles.view"), controller.listPermissions);
