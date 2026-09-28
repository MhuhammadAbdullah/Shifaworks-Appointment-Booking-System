import { Router } from "express";
import { idParamSchema, listNotificationsQuerySchema, previewTemplateSchema, testNotificationSchema, updateTemplateSchema } from "@booking/shared";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./notifications.controller.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/channel-status", requireAnyPermission("notifications.view", "notifications.manage_templates"), controller.channelStatus);
notificationsRouter.post("/test", requirePermission("notifications.send"), validate({ body: testNotificationSchema }), controller.sendTest);
notificationsRouter.get("/", requirePermission("notifications.view"), validate({ query: listNotificationsQuerySchema }), controller.listNotifications);
notificationsRouter.get("/:id", requirePermission("notifications.view"), validate({ params: idParamSchema }), controller.getNotification);
notificationsRouter.post("/:id/retry", requirePermission("notifications.send"), validate({ params: idParamSchema }), controller.retryNotification);

export const emailTemplatesRouter = Router();
emailTemplatesRouter.use(requireAuth);

const canRead = requireAnyPermission("notifications.view", "notifications.manage_templates");
const canManage = requirePermission("notifications.manage_templates");

emailTemplatesRouter.get("/", canRead, controller.listTemplates);
emailTemplatesRouter.post("/preview", canRead, validate({ body: previewTemplateSchema }), controller.previewTemplate);
emailTemplatesRouter.post("/install-defaults", canManage, controller.installDefaultTemplates);
emailTemplatesRouter.patch("/:id", canManage, validate({ params: idParamSchema, body: updateTemplateSchema }), controller.updateTemplate);
