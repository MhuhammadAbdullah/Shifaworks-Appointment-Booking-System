import type { RequestHandler } from "express";
import type {
  CreateUserInput,
  ListUsersQuery,
  SetUserPermissionsInput,
  SetUserRolesInput,
  SetUserStatusInput,
  UpdateUserInput,
} from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as usersService from "./users.service.js";

type IdParams = { id: string };

export const listUsers: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListUsersQuery>(req);
  const { items, ...meta } = await usersService.listUsers(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const getUser: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await usersService.getUser(principalOf(req), params.id));
};

export const createUser: RequestHandler = async (req, res) => {
  const { body } = validated<CreateUserInput>(req);
  const user = await usersService.createUser(principalOf(req), body, auditContextFrom(req));
  sendCreated(res, user, body.sendInvite ? "User created and invitation sent" : "User created");
};

export const updateUser: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateUserInput, unknown, IdParams>(req);
  sendOk(res, await usersService.updateUser(principalOf(req), params.id, body, auditContextFrom(req)), "User updated");
};

export const setStatus: RequestHandler = async (req, res) => {
  const { body, params } = validated<SetUserStatusInput, unknown, IdParams>(req);
  sendOk(res, await usersService.setUserStatus(principalOf(req), params.id, body, auditContextFrom(req)), "Status updated");
};

export const setRoles: RequestHandler = async (req, res) => {
  const { body, params } = validated<SetUserRolesInput, unknown, IdParams>(req);
  sendOk(res, await usersService.setUserRoles(principalOf(req), params.id, body, auditContextFrom(req)), "Roles updated");
};

export const setPermissions: RequestHandler = async (req, res) => {
  const { body, params } = validated<SetUserPermissionsInput, unknown, IdParams>(req);
  sendOk(
    res,
    await usersService.setUserPermissions(principalOf(req), params.id, body, auditContextFrom(req)),
    "Permissions updated",
  );
};

export const sendInvite: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await usersService.sendInvite(principalOf(req), params.id, auditContextFrom(req)), "Invitation sent");
};

export const deleteUser: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await usersService.deleteUser(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
};
