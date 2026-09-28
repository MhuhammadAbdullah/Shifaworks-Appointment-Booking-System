import { createHash, randomUUID } from "node:crypto";
import { IMAGE_MIME_TYPES, MAX_IMAGE_MB, type FileDto } from "@booking/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";
import { sniffImage, sniffPrivateFile } from "./image-sniff.js";

// Public images (provider photos) and private files (payment
// proofs, expense receipts, Phase 6) — two buckets, two visibility levels.

const PRIVATE_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
const ensuredBuckets = new Set<string>();

/** Creates a storage bucket on first use (idempotent). */
export async function ensureBucket(bucket: string, opts: { public: boolean; maxMb: number; mimeTypes: readonly string[] }): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;
  const { data } = await supabaseAdmin.storage.getBucket(bucket);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(bucket, {
      public: opts.public,
      fileSizeLimit: `${opts.maxMb}MB`,
      allowedMimeTypes: [...opts.mimeTypes],
    });
    if (error && !/already exists/i.test(error.message)) {
      logger.error({ bucket, err: error.message }, "failed to create storage bucket");
      throw new AppError("SERVICE_UNAVAILABLE", "File storage is not available");
    }
    logger.info({ bucket }, "created storage bucket");
  }
  ensuredBuckets.add(bucket);
}

export const ensurePublicBucket = (bucket: string) => ensureBucket(bucket, { public: true, maxMb: MAX_IMAGE_MB, mimeTypes: IMAGE_MIME_TYPES });
const ensurePrivateBucket = (bucket: string) => ensureBucket(bucket, { public: false, maxMb: env.MAX_UPLOAD_MB, mimeTypes: PRIVATE_MIME_TYPES });

export function publicFileUrl(file: { bucket: string; path: string } | null | undefined): string | null {
  if (!file) return null;
  return supabaseAdmin.storage.from(file.bucket).getPublicUrl(file.path).data.publicUrl;
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

  const bucket = env.STORAGE_PUBLIC_BUCKET;
  await ensurePublicBucket(bucket);

  const now = new Date();
  const path = `${principal.organizationId}/images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, file.buffer, {
    contentType: sniffed.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    logger.error({ err: error.message, path }, "storage upload failed");
    throw new AppError("SERVICE_UNAVAILABLE", "Upload failed. Please try again.");
  }

  const originalName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `image.${sniffed.ext}`;
  try {
    const row = await prisma.file.create({
      data: {
        organizationId: principal.organizationId,
        bucket,
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
    await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => undefined);
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
 * Phase 11) — same bucket, same validation, same audit trail; only the
 * actor differs (`uploadedById: null` for an anonymous submission).
 */
async function storePrivateFile(organizationId: string, uploadedById: string | null, file: UploadedFile, ctx: AuditContext, action: string): Promise<FileDto> {
  if (file.size === 0) throw AppError.badRequest("The file is empty");
  const sniffed = sniffPrivateFile(file.buffer);
  if (!sniffed) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG, WebP or PDF files are allowed");

  const bucket = env.STORAGE_PRIVATE_BUCKET;
  await ensurePrivateBucket(bucket);

  const now = new Date();
  const path = `${organizationId}/private/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, file.buffer, {
    contentType: sniffed.mime,
    cacheControl: "0",
    upsert: false,
  });
  if (error) {
    logger.error({ err: error.message, path }, "storage upload failed");
    throw new AppError("SERVICE_UNAVAILABLE", "Upload failed. Please try again.");
  }

  const originalName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `file.${sniffed.ext}`;
  try {
    const row = await prisma.file.create({
      data: {
        organizationId,
        bucket,
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
    const { data: signed } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
    return { id: row.id, url: signed?.signedUrl ?? "", mimeType: row.mimeType, sizeBytes: row.sizeBytes, originalName: row.originalName };
  } catch (err) {
    await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => undefined);
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
  const { data, error } = await supabaseAdmin.storage.from(file.bucket).createSignedUrl(file.path, expirySeconds);
  if (error || !data) {
    logger.error({ err: error?.message, fileId }, "failed to sign private file url");
    throw new AppError("SERVICE_UNAVAILABLE", "Could not generate a link to this file");
  }
  return data.signedUrl;
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
