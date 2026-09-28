import type { RequestHandler } from "express";
import type { UpdateMeInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as authService from "./auth.service.js";

export const getMe: RequestHandler = (req, res) => {
  sendOk(res, authService.toMeResponse(principalOf(req)));
};

export const updateMe: RequestHandler = async (req, res) => {
  const { body } = validated<UpdateMeInput>(req);
  const updated = await authService.updateMe(principalOf(req), body, auditContextFrom(req));
  sendOk(res, authService.toMeResponse(updated), "Profile updated");
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(principalOf(req), auditContextFrom(req));
  sendOk(res, null, "Signed out");
};
