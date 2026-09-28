import type { RequestHandler } from "express";
import type { ListNotificationsQuery, PreviewTemplateInput, TestNotificationInput, UpdateTemplateInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as notifications from "./notifications.service.js";
import * as templates from "./templates.service.js";

type IdParams = { id: string };

export const listNotifications: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListNotificationsQuery>(req);
  const { items, ...meta } = await notifications.listNotifications(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const getNotification: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await notifications.getNotification(principalOf(req), params.id));
};

export const retryNotification: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await notifications.retryNotification(principalOf(req), params.id, auditContextFrom(req)), "Queued for another attempt");
};

export const sendTest: RequestHandler = async (req, res) => {
  const { body } = validated<TestNotificationInput>(req);
  sendOk(res, await notifications.sendTest(principalOf(req), body, auditContextFrom(req)));
};

export const channelStatus: RequestHandler = async (_req, res) => {
  sendOk(res, await notifications.channelStatus());
};

export const listTemplates: RequestHandler = async (req, res) => {
  sendOk(res, await templates.listTemplates(principalOf(req)));
};

export const updateTemplate: RequestHandler = async (req, res) => {
  const { params, body } = validated<UpdateTemplateInput, unknown, IdParams>(req);
  sendOk(res, await templates.updateTemplate(principalOf(req), params.id, body, auditContextFrom(req)), "Template saved");
};

export const previewTemplate: RequestHandler = (req, res) => {
  const { body } = validated<PreviewTemplateInput>(req);
  sendOk(res, templates.previewTemplate(body));
};

export const installDefaultTemplates: RequestHandler = async (req, res) => {
  sendOk(res, await templates.installDefaults(principalOf(req), auditContextFrom(req)));
};
