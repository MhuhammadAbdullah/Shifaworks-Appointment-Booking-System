import { Router, type RequestHandler } from "express";
import {
  createProviderSchema,
  idParamSchema,
  inviteProviderSchema,
  listProvidersQuerySchema,
  setProviderServicesSchema,
  updateOwnProviderSchema,
  updateProviderSchema,
  type CreateProviderInput,
  type InviteProviderInput,
  type ListProvidersQuery,
  type SetProviderServicesInput,
  type UpdateOwnProviderInput,
  type UpdateProviderInput,
} from "@booking/shared";
import { principalOf, requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk, sendPaginated } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./providers.service.js";

type IdParams = { id: string };

export const providersRouter = Router();
providersRouter.use(requireAuth);

const requireProvider: RequestHandler = (req, _res, next) => {
  if (!principalOf(req).providerProfileId) throw AppError.forbidden("Only therapists and counsellors have a provider profile");
  next();
};

// --- self-service (registered before /:id) ---------------------------------
providersRouter.get("/me", requireProvider, async (req, res) => {
  sendOk(res, await service.getOwnProvider(principalOf(req)));
});

providersRouter.patch("/me", requireProvider, validate({ body: updateOwnProviderSchema }), async (req, res) => {
  const { body } = validated<UpdateOwnProviderInput>(req);
  sendOk(res, await service.updateOwnProvider(principalOf(req), body, auditContextFrom(req)), "Profile updated");
});

// --- administration ---------------------------------------------------------
// Anyone making manual bookings or assigning services needs to pick providers.
const canViewProviders = requireAnyPermission("providers.view", "bookings.create", "services.update");

providersRouter.get("/", canViewProviders, validate({ query: listProvidersQuerySchema }), async (req, res) => {
  const { query } = validated<unknown, ListProvidersQuery>(req);
  const { items, ...meta } = await service.listProviders(principalOf(req), query);
  sendPaginated(res, items, meta);
});

providersRouter.get("/:id", canViewProviders, validate({ params: idParamSchema }), async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.getProvider(principalOf(req), params.id));
});

providersRouter.post("/", requirePermission("providers.create"), validate({ body: createProviderSchema }), async (req, res) => {
  const { body } = validated<CreateProviderInput>(req);
  sendCreated(res, await service.createProvider(principalOf(req), body, auditContextFrom(req)), "Provider added");
});

providersRouter.patch(
  "/:id",
  requirePermission("providers.update"),
  validate({ params: idParamSchema, body: updateProviderSchema }),
  async (req, res) => {
    const { body, params } = validated<UpdateProviderInput, unknown, IdParams>(req);
    sendOk(res, await service.updateProvider(principalOf(req), params.id, body, auditContextFrom(req)), "Provider updated");
  },
);

providersRouter.delete("/:id", requirePermission("providers.delete"), validate({ params: idParamSchema }), async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await service.deleteProvider(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
});

providersRouter.put(
  "/:id/services",
  requirePermission("providers.update"),
  validate({ params: idParamSchema, body: setProviderServicesSchema }),
  async (req, res) => {
    const { body, params } = validated<SetProviderServicesInput, unknown, IdParams>(req);
    sendOk(res, await service.setProviderServices(principalOf(req), params.id, body.serviceIds, auditContextFrom(req)), "Services updated");
  },
);

/** Creates or re-sends the provider's dashboard login (needs account-management rights too). */
providersRouter.post(
  "/:id/invite",
  requirePermission("providers.update", "staff.create"),
  validate({ params: idParamSchema, body: inviteProviderSchema }),
  async (req, res) => {
    const { body, params } = validated<InviteProviderInput, unknown, IdParams>(req);
    sendOk(res, await service.inviteProvider(principalOf(req), params.id, body, auditContextFrom(req)), "Invitation sent");
  },
);
