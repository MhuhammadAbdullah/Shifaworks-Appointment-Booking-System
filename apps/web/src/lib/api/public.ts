"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AvailableDatesDto,
  FileDto,
  Gender,
  PublicBookingResponse,
  PublicBrandingDto,
  PublicProviderDto,
  PublicServiceDto,
  ServiceSlug,
  SlotsDto,
} from "@booking/shared";
import { apiRequest } from "@/lib/api-client";

/** Unauthenticated calls to /public/*: no access token, ever. */
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** Org name + logo for the booking forms' header — falls back to plain text while loading or if no logo is set. */
export function usePublicBranding() {
  return useQuery({
    queryKey: ["public", "branding"],
    queryFn: ({ signal }) => data(apiRequest<PublicBrandingDto>("/public/branding", { signal })),
    staleTime: 5 * 60_000,
  });
}

export function useServiceBootstrap(slug: ServiceSlug) {
  return useQuery({
    queryKey: ["public", "service", slug],
    queryFn: ({ signal }) => data(apiRequest<PublicServiceDto>(`/public/services/${slug}`, { signal })),
    staleTime: 30_000,
  });
}

export function usePublicProviders(slug: ServiceSlug, gender: Gender | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["public", "providers", slug, gender],
    queryFn: ({ signal }) => data(apiRequest<PublicProviderDto[]>("/public/providers", { query: { service: slug, gender }, signal })),
    enabled,
    staleTime: 30_000,
  });
}

interface SlotParams {
  slug: ServiceSlug;
  providerId: string;
  packageId: string;
}

export function usePublicAvailableDates(params: (SlotParams & { from: string; to: string }) | null) {
  return useQuery({
    queryKey: ["public", "dates", params],
    queryFn: ({ signal }) =>
      data(
        apiRequest<AvailableDatesDto>("/public/availability/dates", {
          query: { service: params!.slug, provider: params!.providerId, package: params!.packageId, from: params!.from, to: params!.to },
          signal,
        }),
      ),
    enabled: params !== null,
    staleTime: 15_000,
  });
}

export function usePublicSlots(params: (SlotParams & { date: string }) | null) {
  return useQuery({
    queryKey: ["public", "slots", params],
    queryFn: ({ signal }) =>
      data(
        apiRequest<SlotsDto>("/public/availability/slots", {
          query: { service: params!.slug, provider: params!.providerId, package: params!.packageId, date: params!.date },
          signal,
        }),
      ),
    enabled: params !== null,
    staleTime: 5_000,
  });
}

export function useSubmitBooking() {
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: unknown; idempotencyKey: string }) =>
      data(apiRequest<PublicBookingResponse>("/public/bookings", { method: "POST", body, idempotencyKey })),
  });
}

/** Uploads a payment receipt before the booking exists yet — its own step in the review screen. */
export function useUploadPublicReceipt() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return data(apiRequest<FileDto>("/public/bookings/receipt", { method: "POST", formData }));
    },
  });
}
