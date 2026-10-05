import { createHash, randomUUID } from "node:crypto";
import { IMAGE_MIME_TYPES, type FileDto } from "@booking/shared";
import { logger } from "../../config/logger.js";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { destroyFile, publicUrl, signedUrl, uploadBuffer, type CloudinaryResourceType } from "../../lib/cloudinary.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";
import { sniffImage, sniffPrivateFile } from "./image-sniff.js";

// Public images (provider photos) and private files (payment proofs, expense
// receipts) — same Cloudinary account, separated by resource type + delivery
// type (`File.bucket` = resource type, `File.path` = public_id.ext,
// `File.visibility` decides "upload" vs "authenticated" — see lib/cloudinary.ts).

const PRIVATE_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
const resourceTypeFor = (mime: string): CloudinaryResourceType => (mime === "application/pdf" ? "raw" : "image");

export function publicFileUrl(file: { bucket: string; path: string } | null | undefined): string | null {
  if (!file) return null;
  return publicUrl(file.path, file.bucket as CloudinaryResourceType);
}

/** Prisma select for relations that render an image URL. */
export const fileUrlSelect = { select: { bucket: true, path: true } } as const;

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export async function uploadPublicImage(principal: Principal, file: UploadedFile, ctx: AuditContext): Promise<FileDto> {
  if (file.size === 0) throw AppError.badRequest("The file is empty");
  // The real type comes from the file's bytes, never the client's Content-Type.
  const sniffed = sniffImage(file.buffer);
  if (!sniffed) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG or WebP images are allowed");

  const now = new Date();
  const path = `${principal.organizationId}/images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${sniffed.ext}`;
  const resourceType = resourceTypeFor(sniffed.mime);
  try {
    await uploadBuffer(file.buffer, path, { resourceType, type: "upload" });
  } catch (err) {
    logger.error({ err, path }, "storage upload failed");
    throw new AppError("SERVICE_UNAVAILABLE", "Upload failed. Please try again.");
  }

  const originalName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `image.${sniffed.ext}`;
  try {
    const row = await prisma.file.create({
      data: {
        organizationId: principal.organizationId,
        bucket: resourceType,
        path,
        originalName,
        mimeType: sniffed.mime,
        sizeBytes: file.size,
        checksumSha256: createHash("sha256").update(file.buffer).digest("hex"),
        visibility: "PUBLIC",
        uploadedById: principal.userId,
      },
    });
    await recordAudit(prisma, ctx, {
      action: "file.upload",
      entityType: "file",
      entityId: row.id,
      newValues: { path, mimeType: sniffed.mime, sizeBytes: file.size },
    });
    return { id: row.id, url: publicFileUrl(row)!, mimeType: row.mimeType, sizeBytes: row.sizeBytes, originalName: row.originalName };
  } catch (err) {
    await destroyFile(path, { resourceType, type: "upload" }).catch(() => undefined);
    throw err;
  }
}

/**
 * Validates that an image id sent by a client refers to a public image of the
 * same organisation (prevents attaching someone else's or a private file).
 */
export async function assertPublicImage(db: DbClient, organizationId: string, fileId: string | null | undefined, path = "imageId") {
  if (!fileId) return;
  const file = await db.file.findFirst({
    where: { id: fileId, organizationId, visibility: "PUBLIC", deletedAt: null },
    select: { mimeType: true },
  });
  if (!file || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    throw AppError.validation([{ path, message: "Image not found; upload it again" }]);
  }
}

// ---------------------------------------------------------------------------
// Private files: payment proofs, expense receipts (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Shared by staff uploads (payment proofs, expense receipts) and anonymous
 * public uploads (a customer's payment receipt attached at booking time,
 * Phase 11) — same storage, same validation, same audit trail; only the
 * actor differs (`uploadedById: null` for an anonymous submission).
 */
async function storePrivateFile(organizationId: string, uploadedById: string | null, file: UploadedFile, ctx: AuditContext, action: string): Promise<FileDto> {
  if (file.size === 0) throw AppError.badRequest("The file is empty");
  const sniffed = sniffPrivateFile(file.buffer);
  if (!sniffed) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG, WebP or PDF files are allowed");

  const now = new Date();
  const path = `${organizationId}/private/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${sniffed.ext}`;
  const resourceType = resourceTypeFor(sniffed.mime);
  try {
    await uploadBuffer(file.buffer, path, { resourceType, type: "authenticated" });
  } catch (err) {
    logger.error({ err, path }, "storage upload failed");
    throw new AppError("SERVICE_UNAVAILABLE", "Upload failed. Please try again.");
  }

  const originalName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `file.${sniffed.ext}`;
  try {
    const row = await prisma.file.create({
      data: {
        organizationId,
        bucket: resourceType,
        path,
        originalName,
        mimeType: sniffed.mime,
        sizeBytes: file.size,
        checksumSha256: createHash("sha256").update(file.buffer).digest("hex"),
        visibility: "PRIVATE",
        uploadedById,
      },
    });
    await recordAudit(prisma, ctx, {
      action,
      entityType: "file",
      entityId: row.id,
      newValues: { path, mimeType: sniffed.mime, sizeBytes: file.size },
    });
    return { id: row.id, url: signedUrl(row.path, resourceType, 300), mimeType: row.mimeType, sizeBytes: row.sizeBytes, originalName: row.originalName };
  } catch (err) {
    await destroyFile(path, { resourceType, type: "authenticated" }).catch(() => undefined);
    throw err;
  }
}

export function uploadPrivateFile(principal: Principal, file: UploadedFile, ctx: AuditContext): Promise<FileDto> {
  return storePrivateFile(principal.organizationId, principal.userId, file, ctx, "file.upload_private");
}

/** Anonymous upload: a customer's payment receipt attached to the public booking form, before the booking exists. */
export function uploadPrivateFileAnonymous(organizationId: string, file: UploadedFile, ctx: AuditContext): Promise<FileDto> {
  return storePrivateFile(organizationId, null, file, ctx, "file.upload_receipt");
}

/** A short-lived URL to view a private file (payment proof, expense receipt). Never cached, generated on demand. */
export async function privateFileSignedUrl(db: DbClient, organizationId: string, fileId: string, expirySeconds = 300): Promise<string> {
  const file = await db.file.findFirst({ where: { id: fileId, organizationId, visibility: "PRIVATE", deletedAt: null } });
  if (!file) throw AppError.notFound("File");
  try {
    return signedUrl(file.path, file.bucket as CloudinaryResourceType, expirySeconds);
  } catch (err) {
    logger.error({ err, fileId }, "failed to sign private file url");
    throw new AppError("SERVICE_UNAVAILABLE", "Could not generate a link to this file");
  }
}

/**
 * Validates that a private-file id sent by a client refers to a private file
 * of the same organisation (payment proof / expense receipt uploads).
 */
export async function assertPrivateFile(db: DbClient, organizationId: string, fileId: string | null | undefined, path = "fileId") {
  if (!fileId) return;
  const file = await db.file.findFirst({
    where: { id: fileId, organizationId, visibility: "PRIVATE", deletedAt: null },
    select: { mimeType: true },
  });
  if (!file || !PRIVATE_MIME_TYPES.includes(file.mimeType)) {
    throw AppError.validation([{ path, message: "File not found; upload it again" }]);
  }
}
