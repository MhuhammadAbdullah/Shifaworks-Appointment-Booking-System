"use client";

import { useMutation } from "@tanstack/react-query";
import type { FileDto } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** Payment proofs, expense receipts: uploaded to a private bucket, never a public URL. */
export function useUploadPrivateFile() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return data(authedRequest<FileDto>("/files/private", { method: "POST", formData }));
    },
  });
}

/** Fetches a fresh short-lived link to an already-uploaded private file (opens in a new tab). */
export async function openPrivateFile(id: string): Promise<void> {
  const { url } = await data(authedRequest<{ url: string }>(`/files/private/${id}/url`));
  window.open(url, "_blank", "noopener,noreferrer");
}
