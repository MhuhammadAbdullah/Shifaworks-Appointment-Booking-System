import type { RequestHandler } from "express";
import type { CreateRoleInput, UpdateRoleInput } from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as rolesService from "./roles.service.js";

type IdParams = { id: string };

export const listRoles: RequestHandler = async (req, res) => {
  sendOk(res, await rolesService.listRoles(principalOf(req)));
};

export const listPermissions: RequestHandler = async (_req, res) => {
  sendOk(res, await rolesService.listPermissions());
};

export const createRole: RequestHandler = async (req, res) => {
  const { body } = validated<CreateRoleInput>(req);
  sendCreated(res, await rolesService.createRole(principalOf(req), body, auditContextFrom(req)), "Role created");
};

export const updateRole: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateRoleInput, unknown, IdParams>(req);
  sendOk(res, await rolesService.updateRole(principalOf(req), params.id, body, auditContextFrom(req)), "Role updated");
};

export const deleteRole: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await rolesService.deleteRole(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
};
