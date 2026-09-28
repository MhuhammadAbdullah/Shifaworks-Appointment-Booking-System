import { Router } from "express";
import { updateSettingsSchema } from "@booking/shared";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./settings.controller.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requirePermission("settings.manage"));

settingsRouter.get("/", controller.getSettings);
settingsRouter.patch("/", validate({ body: updateSettingsSchema }), controller.updateSettings);
