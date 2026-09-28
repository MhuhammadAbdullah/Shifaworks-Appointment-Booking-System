import { Router } from "express";
import { z } from "zod";
import {
  createConcernOptionSchema,
  createPackageSchema,
  setServiceProvidersSchema,
  updateConcernOptionSchema,
  updatePackageSchema,
  updateServiceSchema,
  type CreateConcernOptionInput,
  type CreatePackageInput,
  type SetServiceProvidersInput,
  type UpdateConcernOptionInput,
  type UpdatePackageInput,
  type UpdateServiceInput,
} from "@booking/shared";
import { principalOf, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as service from "./services.service.js";

/**
 * Staff management of the five services (no create/delete: each service has
 * a developer-defined form). `:id` accepts the id or the slug.
 */
export const servicesRouter = Router();
servicesRouter.use(requireAuth);

const idParams = z.object({ id: z.string().trim().min(2).max(80) });
const packageParams = idParams.extend({ packageId: z.uuid() });
const optionParams = idParams.extend({ optionId: z.uuid() });
type IdParams = z.infer<typeof idParams>;
type PackageParams = z.infer<typeof packageParams>;
type OptionParams = z.infer<typeof optionParams>;

servicesRouter.get("/", requirePermission("services.view"), async (req, res) => {
  sendOk(res, await service.listServices(principalOf(req)));
});

servicesRouter.get("/:id", requirePermission("services.view"), validate({ params: idParams }), async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await service.getService(principalOf(req), params.id));
});

servicesRouter.patch(
  "/:id",
  requirePermission("services.update"),
  validate({ params: idParams, body: updateServiceSchema }),
  async (req, res) => {
    const { body, params } = validated<UpdateServiceInput, unknown, IdParams>(req);
    sendOk(res, await service.updateService(principalOf(req), params.id, body, auditContextFrom(req)), "Service updated");
  },
);

servicesRouter.put(
  "/:id/providers",
  requirePermission("services.update"),
  validate({ params: idParams, body: setServiceProvidersSchema }),
  async (req, res) => {
    const { body, params } = validated<SetServiceProvidersInput, unknown, IdParams>(req);
    sendOk(res, await service.setServiceProviders(principalOf(req), params.id, body, auditContextFrom(req)), "Providers updated");
  },
);

servicesRouter.post(
  "/:id/packages",
  requirePermission("services.manage_packages"),
  validate({ params: idParams, body: createPackageSchema }),
  async (req, res) => {
    const { body, params } = validated<CreatePackageInput, unknown, IdParams>(req);
    sendCreated(res, await service.createPackage(principalOf(req), params.id, body, auditContextFrom(req)), "Added");
  },
);

servicesRouter.patch(
  "/:id/packages/:packageId",
  requirePermission("services.manage_packages"),
  validate({ params: packageParams, body: updatePackageSchema }),
  async (req, res) => {
    const { body, params } = validated<UpdatePackageInput, unknown, PackageParams>(req);
    sendOk(
      res,
      await service.updatePackage(principalOf(req), params.id, params.packageId, body, auditContextFrom(req)),
      "Saved",
    );
  },
);

servicesRouter.delete(
  "/:id/packages/:packageId",
  requirePermission("services.manage_packages"),
  validate({ params: packageParams }),
  async (req, res) => {
    const { params } = validated<unknown, unknown, PackageParams>(req);
    await service.deletePackage(principalOf(req), params.id, params.packageId, auditContextFrom(req));
    sendNoContent(res);
  },
);

servicesRouter.post(
  "/:id/concern-options",
  requirePermission("services.manage_concern_options"),
  validate({ params: idParams, body: createConcernOptionSchema }),
  async (req, res) => {
    const { body, params } = validated<CreateConcernOptionInput, unknown, IdParams>(req);
    sendCreated(res, await service.createConcernOption(principalOf(req), params.id, body, auditContextFrom(req)), "Added");
  },
);

servicesRouter.patch(
  "/:id/concern-options/:optionId",
  requirePermission("services.manage_concern_options"),
  validate({ params: optionParams, body: updateConcernOptionSchema }),
  async (req, res) => {
    const { body, params } = validated<UpdateConcernOptionInput, unknown, OptionParams>(req);
    sendOk(
      res,
      await service.updateConcernOption(principalOf(req), params.id, params.optionId, body, auditContextFrom(req)),
      "Saved",
    );
  },
);

servicesRouter.delete(
  "/:id/concern-options/:optionId",
  requirePermission("services.manage_concern_options"),
  validate({ params: optionParams }),
  async (req, res) => {
    const { params } = validated<unknown, unknown, OptionParams>(req);
    await service.deleteConcernOption(principalOf(req), params.id, params.optionId, auditContextFrom(req));
    sendNoContent(res);
  },
);
