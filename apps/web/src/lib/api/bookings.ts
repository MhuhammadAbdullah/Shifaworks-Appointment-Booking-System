"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BookingDetailDto,
  BookingListItemDto,
  CancelBookingInput,
  ListBookingsQuery,
  ManualBookingInput,
  RescheduleBookingInput,
  UpdateBookingDetailsInput,
  UpdateBookingNotesInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** `status` travels as a comma-separated string on the wire (multi-select) — the server parses it back into ListBookingsQuery["status"]. */
type BookingsListQuery = Partial<Omit<ListBookingsQuery, "status">> & { status?: string };

export const bookingKeys = {
  list: (q: BookingsListQuery) => ["bookings", "list", q] as const,
  listAll: ["bookings", "list"] as const,
  detail: (id: string) => ["bookings", "detail", id] as const,
};

export function useBookings(query: BookingsListQuery) {
  return useQuery({
    queryKey: bookingKeys.list(query),
    queryFn: ({ signal }) => authedRequest<BookingListItemDto[]>("/bookings", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadBookingsCsv(query: BookingsListQuery): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/bookings/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export bookings");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `bookings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: bookingKeys.detail(id),
    queryFn: ({ signal }) => data(authedRequest<BookingDetailDto>(`/bookings/${id}`, { signal })),
  });
}

function useBookingMutation<TInput>(request: (input: TInput) => Promise<BookingDetailDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (b) => {
      qc.setQueryData(bookingKeys.detail(b.id), b);
      void qc.invalidateQueries({ queryKey: bookingKeys.listAll });
    },
  });
}

export const useCreateManualBooking = () =>
  useBookingMutation((body: ManualBookingInput) => data(authedRequest<BookingDetailDto>("/bookings/manual", { method: "POST", body })));

export const useCancelBooking = (id: string) =>
  useBookingMutation((body: CancelBookingInput) => data(authedRequest<BookingDetailDto>(`/bookings/${id}/cancel`, { method: "POST", body })));

export const useRescheduleBooking = (id: string) =>
  useBookingMutation((body: RescheduleBookingInput) => data(authedRequest<BookingDetailDto>(`/bookings/${id}/reschedule`, { method: "POST", body })));

export const useConfirmBooking = (id: string) =>
  useBookingMutation(() => data(authedRequest<BookingDetailDto>(`/bookings/${id}/confirm`, { method: "POST" })));

export const useCompleteBooking = (id: string) =>
  useBookingMutation(() => data(authedRequest<BookingDetailDto>(`/bookings/${id}/complete`, { method: "POST" })));

export const useMarkNoShow = (id: string) =>
  useBookingMutation(() => data(authedRequest<BookingDetailDto>(`/bookings/${id}/no-show`, { method: "POST" })));

export const useResendConfirmation = (id: string) =>
  useBookingMutation(() => data(authedRequest<BookingDetailDto>(`/bookings/${id}/resend-confirmation`, { method: "POST" })));

export const useUpdateBookingNotes = (id: string) =>
  useBookingMutation((body: UpdateBookingNotesInput) => data(authedRequest<BookingDetailDto>(`/bookings/${id}/notes`, { method: "PATCH", body })));

export const useUpdateBookingDetails = (id: string) =>
  useBookingMutation((body: UpdateBookingDetailsInput) => data(authedRequest<BookingDetailDto>(`/bookings/${id}`, { method: "PATCH", body })));

export function useDeleteBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedRequest<void>(`/bookings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: bookingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: bookingKeys.listAll });
    },
  });
}

export interface BulkDeleteResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

/** Deletes each booking independently (the guard is per-booking) and reports which ones could not be removed. */
export function useBulkDeleteBookings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<BulkDeleteResult> => {
      const results = await Promise.allSettled(ids.map((id) => authedRequest<void>(`/bookings/${id}`, { method: "DELETE" })));
      const failed: BulkDeleteResult["failed"] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded++;
        else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Could not delete" });
      });
      return { succeeded, failed };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: bookingKeys.listAll }),
  });
}
