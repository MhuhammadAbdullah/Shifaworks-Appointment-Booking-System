/**
 * Detects the real image type from the file's magic bytes. The client-sent
 * Content-Type and file extension are never trusted: a renamed HTML/SVG file
 * could otherwise be served from our public bucket.
 */
export type SniffedImage = { mime: "image/jpeg"; ext: "jpg" } | { mime: "image/png"; ext: "png" } | { mime: "image/webp"; ext: "webp" };

export function sniffImage(buf: Uint8Array): SniffedImage | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= png.length && png.every((b, i) => buf[i] === b)) {
    return { mime: "image/png", ext: "png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export type SniffedPrivate = SniffedImage | { mime: "application/pdf"; ext: "pdf" };

/** Images or PDF (for private form uploads). */
export function sniffPrivateFile(buf: Uint8Array): SniffedPrivate | null {
  const img = sniffImage(buf);
  if (img) return img;
  if (buf.length >= 5 && String.fromCharCode(...buf.subarray(0, 5)) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}
