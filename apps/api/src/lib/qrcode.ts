/**
 * Digital-ticket QR codes (check-in, Phase 11). The QR encodes a deep link to
 * the staff check-in page carrying the appointment's opaque `checkInToken` —
 * never the booking number — so a plain phone camera opens something useful
 * too (the staff check-in page, prompting login), not just raw text.
 *
 * The PNG is hosted as a public image at a deterministic path and referenced
 * by URL from the confirmation email, rather than inlined as a base64 data
 * URI: more reliable across email clients (some strip data: images). The
 * image itself leaks nothing — the token alone is useless without staff
 * access to /check-in.
 */
import QRCode from "qrcode";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { publicUrl, uploadBuffer } from "./cloudinary.js";
import { AppError } from "../utils/app-error.js";

export function checkInDeepLink(token: string): string {
  return `${env.APP_URL}/admin/check-in?token=${token}`;
}

/** Idempotent: re-uploading the same appointment's QR overwrites the same path with identical bytes. */
export async function checkInQrPublicUrl(organizationId: string, appointmentId: string, token: string): Promise<string> {
  const path = `${organizationId}/tickets/${appointmentId}.png`;
  const png = await QRCode.toBuffer(checkInDeepLink(token), { type: "png", width: 480, margin: 2 });
  try {
    await uploadBuffer(png, path, { resourceType: "image", type: "upload", overwrite: true });
  } catch (err) {
    logger.error({ err, path }, "failed to upload check-in QR code");
    throw new AppError("SERVICE_UNAVAILABLE", "Could not generate the ticket QR code");
  }
  return publicUrl(path, "image");
}
