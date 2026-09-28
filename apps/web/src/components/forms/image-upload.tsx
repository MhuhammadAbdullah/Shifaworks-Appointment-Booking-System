"use client";

import { useRef } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { IMAGE_MIME_TYPES, MAX_IMAGE_MB } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { useUploadImage } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ImageUploadProps {
  id: string;
  url: string | null;
  onChange: (value: { id: string; url: string } | null) => void;
  disabled?: boolean;
  /** "square" for avatars, "wide" for service/category banners. */
  shape?: "square" | "wide";
}

/** Uploads immediately to /files/images and reports the new file id + URL. */
export function ImageUpload({ id, url, onChange, disabled, shape = "wide" }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadImage();

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Choose a JPEG, PNG or WebP image");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`Images must be ${MAX_IMAGE_MB} MB or smaller`);
      return;
    }
    upload.mutate(file, {
      onSuccess: (f) => onChange({ id: f.id, url: f.url }),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Upload failed"),
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
          shape === "square" ? "size-20 rounded-full" : "h-20 w-32",
        )}
      >
        {upload.isPending ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Supabase URL; no optimisation needed here
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          className="sr-only"
          disabled={disabled || upload.isPending}
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {url ? "Replace image" : "Upload image"}
        </Button>
        {url && !disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="size-4" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
