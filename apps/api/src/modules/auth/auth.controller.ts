import type { RequestHandler } from "express";
import type { UpdateMeInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { confirmRecoverySession } from "./recovery-lock.js";
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

/** Called right after the browser successfully sets a new password, so this recovery session stops being restricted. */
export const confirmRecovery: RequestHandler = (req, res) => {
  if (!req.sessionId) throw AppError.unauthenticated();
  confirmRecoverySession(req.sessionId);
  sendOk(res, null);
};
