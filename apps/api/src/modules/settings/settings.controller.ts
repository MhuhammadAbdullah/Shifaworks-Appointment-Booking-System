import type { RequestHandler } from "express";
import type { UpdateSettingsInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as settings from "./settings.service.js";

export const getSettings: RequestHandler = async (req, res) => {
  sendOk(res, await settings.getSettingsPage(principalOf(req)));
};

export const updateSettings: RequestHandler = async (req, res) => {
  const { body } = validated<UpdateSettingsInput>(req);
  sendOk(res, await settings.updateSettingsPage(principalOf(req), body, auditContextFrom(req)), "Settings saved");
};
