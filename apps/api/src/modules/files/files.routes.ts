import { Router, type RequestHandler } from "express";
import multer from "multer";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { idParamSchema, MAX_IMAGE_MB, type ApiFailure } from "@booking/shared";
import { env } from "../../config/env.js";
import { principalOf, requireAuth } from "../../middleware/auth.js";
import { validate, validated } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { hasPermission } from "../auth/permission-rules.js";
import { sendCreated, sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { privateFileSignedUrl, uploadPrivateFile, uploadPublicImage } from "./files.service.js";

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: 1, fields: 5 },
});

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => req.principal?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    const body: ApiFailure = { success: false, code: "RATE_LIMITED", message: "Too many uploads, slow down" };
    res.status(429).json(body);
  },
});

/** Image uploads: provider editors, settings, and providers (own photo). */
const canUploadImages: RequestHandler = (req, _res, next) => {
  const p = principalOf(req);
  const allowed =
    p.providerProfileId !== null ||
    (["providers.create", "providers.update", "settings.manage"] as const).some((k) => hasPermission(p, k));
  if (!allowed) throw AppError.forbidden();
  next();
};

filesRouter.post("/images", canUploadImages, uploadLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) throw AppError.badRequest('Attach the image in a form field named "file"');
  sendCreated(res, await uploadPublicImage(principalOf(req), req.file, auditContextFrom(req)), "Image uploaded");
});

/** Private uploads: payment proofs, expense receipts. */
const canUploadPrivateFiles: RequestHandler = (req, _res, next) => {
  const p = principalOf(req);
  if (!(["payments.verify", "expenses.create", "expenses.update"] as const).some((k) => hasPermission(p, k))) throw AppError.forbidden();
  next();
};

const uploadPrivate = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
});

filesRouter.post("/private", canUploadPrivateFiles, uploadLimiter, uploadPrivate.single("file"), async (req, res) => {
  if (!req.file) throw AppError.badRequest('Attach the file in a form field named "file"');
  sendCreated(res, await uploadPrivateFile(principalOf(req), req.file, auditContextFrom(req)), "File uploaded");
});

filesRouter.get("/private/:id/url", validate({ params: idParamSchema }), async (req, res) => {
  const p = principalOf(req);
  if (!(["payments.view", "expenses.view"] as const).some((k) => hasPermission(p, k))) throw AppError.forbidden();
  const { params } = validated<unknown, unknown, { id: string }>(req);
  res.setHeader("Cache-Control", "no-store");
  sendOk(res, { url: await privateFileSignedUrl(prisma, p.organizationId, params.id) });
});
