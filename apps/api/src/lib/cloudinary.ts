/**
 * All file/image storage (provider photos, payment proofs, expense receipts,
 * weekly log archives) — Cloudinary, not Supabase Storage. Supabase is still
 * used for auth (JWT verification, user management); only the storage layer
 * moved. No bucket-style pre-creation needed — Cloudinary namespaces by
 * public_id path segments, created implicitly on first upload.
 */
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type CloudinaryResourceType = "image" | "raw";
/** Cloudinary's delivery type — "upload" serves without a signature, "authenticated" requires one. */
export type CloudinaryDeliveryType = "upload" | "authenticated";

/** public_id with no extension, and the format separately — mirrors how the old Supabase object key embedded the extension in its path. */
export function splitPublicId(path: string): { publicId: string; format: string } {
  const i = path.lastIndexOf(".");
  return i === -1 ? { publicId: path, format: "" } : { publicId: path.slice(0, i), format: path.slice(i + 1) };
}

export function uploadBuffer(
  buffer: Buffer,
  path: string,
  opts: { resourceType: CloudinaryResourceType; type: CloudinaryDeliveryType; overwrite?: boolean },
): Promise<UploadApiResponse> {
  const { publicId, format } = splitPublicId(path);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: opts.resourceType, type: opts.type, format: format || undefined, overwrite: opts.overwrite ?? false, unique_filename: false, use_filename: false },
      (error, result) => (error || !result ? reject(error ?? new Error("Cloudinary upload returned no result")) : resolve(result)),
    );
    stream.end(buffer);
  });
}

export async function destroyFile(path: string, opts: { resourceType: CloudinaryResourceType; type: CloudinaryDeliveryType }): Promise<void> {
  const { publicId, format } = splitPublicId(path);
  await cloudinary.uploader.destroy(format ? `${publicId}.${format}` : publicId, { resource_type: opts.resourceType, type: opts.type, invalidate: true });
}

/** A permanent, unsigned delivery URL — for `type: "upload"` (public) assets only. */
export function publicUrl(path: string, resourceType: CloudinaryResourceType): string {
  const { publicId, format } = splitPublicId(path);
  return cloudinary.url(publicId, { resource_type: resourceType, type: "upload", format: format || undefined, secure: true });
}

/** A time-limited signed URL — for `type: "authenticated"` (private) assets. `expires_at` is baked into the signature Cloudinary's CDN checks, same idea as Supabase's signed URLs. */
export function signedUrl(path: string, resourceType: CloudinaryResourceType, expirySeconds: number): string {
  const { publicId, format } = splitPublicId(path);
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    format: format || undefined,
    secure: true,
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + expirySeconds,
  });
}
