import type { RequestHandler } from "express";
import type { CheckInLookupQuery } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendOk } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as checkin from "./checkin.service.js";

type IdParams = { appointmentId: string };

export const lookup: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, CheckInLookupQuery>(req);
  sendOk(res, await checkin.lookup(principalOf(req), query));
};

export const checkIn: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  const result = await checkin.checkIn(principalOf(req), params.appointmentId, auditContextFrom(req));
  sendOk(res, result, result.alreadyCheckedIn ? "Already checked in" : "Checked in");
};

export const reset: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await checkin.reset(principalOf(req), params.appointmentId, auditContextFrom(req)), "Check-in reset");
};
