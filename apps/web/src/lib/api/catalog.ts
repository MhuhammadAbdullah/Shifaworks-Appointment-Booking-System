"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  AvailabilityDto,
  AvailableDatesDto,
  AvailableDatesQuery,
  BulkCreateExceptionsInput,
  ConcernOptionDto,
  CreateBlockedSlotInput,
  CreateConcernOptionInput,
  CreateExceptionInput,
  CreateHolidayInput,
  CreatePackageInput,
  CreateProviderInput,
  FileDto,
  HolidayDto,
  InviteProviderInput,
  ListProvidersQuery,
  PackageDto,
  ProviderDto,
  ServiceDto,
  SetServiceProvidersInput,
  SlotsDto,
  SlotsQuery,
  UpdateConcernOptionInput,
  UpdateOwnProviderInput,
  UpdatePackageInput,
  UpdateProviderInput,
  UpdateServiceInput,
  WeeklyScheduleInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";

type Query = Record<string, string | number | boolean | undefined>;

export const catalogKeys = {
  services: ["catalog", "services"] as const,
  service: (idOrSlug: string) => ["catalog", "services", idOrSlug] as const,
  providers: ["catalog", "providers"] as const,
  provider: (id: string) => ["catalog", "providers", id] as const,
  ownProvider: ["catalog", "providers", "me"] as const,
  availability: (providerId: string) => ["catalog", "availability", providerId] as const,
  holidays: ["catalog", "holidays"] as const,
  preview: ["catalog", "preview"] as const,
};

/** Mutation that refreshes every query under the given key prefixes. */
function useInvalidatingMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

// ---- uploads --------------------------------------------------------------------

export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return data(authedRequest<FileDto>("/files/images", { method: "POST", formData }));
    },
  });
}

// ---- services & packages ------------------------------------------------------------

export function useServices(enabled = true) {
  return useQuery({
    queryKey: catalogKeys.services,
    queryFn: ({ signal }) => data(authedRequest<ServiceDto[]>("/services", { signal })),
    enabled,
    staleTime: 60_000,
  });
}
export function useService(idOrSlug: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.service(idOrSlug),
    queryFn: ({ signal }) => data(authedRequest<ServiceDto>(`/services/${idOrSlug}`, { signal })),
    enabled: enabled && idOrSlug.length > 0,
  });
}
const serviceChanges = [catalogKeys.services, catalogKeys.providers, catalogKeys.preview];
export const useUpdateService = (id: string) =>
  useInvalidatingMutation((body: UpdateServiceInput) => data(authedRequest<ServiceDto>(`/services/${id}`, { method: "PATCH", body })), serviceChanges);
export const useSetServiceProviders = (id: string) =>
  useInvalidatingMutation(
    (body: SetServiceProvidersInput) => data(authedRequest<ServiceDto>(`/services/${id}/providers`, { method: "PUT", body })),
    serviceChanges,
  );
export const useCreatePackage = (serviceId: string) =>
  useInvalidatingMutation(
    (body: CreatePackageInput) => data(authedRequest<PackageDto>(`/services/${serviceId}/packages`, { method: "POST", body })),
    serviceChanges,
  );
export const useUpdatePackage = (serviceId: string) =>
  useInvalidatingMutation(
    ({ id, body }: { id: string; body: UpdatePackageInput }) =>
      data(authedRequest<PackageDto>(`/services/${serviceId}/packages/${id}`, { method: "PATCH", body })),
    serviceChanges,
  );
export const useDeletePackage = (serviceId: string) =>
  useInvalidatingMutation(
    (id: string) => authedRequest<void>(`/services/${serviceId}/packages/${id}`, { method: "DELETE" }),
    serviceChanges,
  );

export const useCreateConcernOption = (serviceId: string) =>
  useInvalidatingMutation(
    (body: CreateConcernOptionInput) => data(authedRequest<ConcernOptionDto>(`/services/${serviceId}/concern-options`, { method: "POST", body })),
    serviceChanges,
  );
export const useUpdateConcernOption = (serviceId: string) =>
  useInvalidatingMutation(
    ({ id, body }: { id: string; body: UpdateConcernOptionInput }) =>
      data(authedRequest<ConcernOptionDto>(`/services/${serviceId}/concern-options/${id}`, { method: "PATCH", body })),
    serviceChanges,
  );
export const useDeleteConcernOption = (serviceId: string) =>
  useInvalidatingMutation(
    (id: string) => authedRequest<void>(`/services/${serviceId}/concern-options/${id}`, { method: "DELETE" }),
    serviceChanges,
  );

// ---- providers --------------------------------------------------------------------

export function useProviders(query: Partial<ListProvidersQuery> = {}, enabled = true) {
  return useQuery({
    queryKey: [...catalogKeys.providers, query],
    queryFn: ({ signal }) => authedRequest<ProviderDto[]>("/providers", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
export function useProvider(id: string) {
  return useQuery({
    queryKey: catalogKeys.provider(id),
    queryFn: ({ signal }) => data(authedRequest<ProviderDto>(`/providers/${id}`, { signal })),
  });
}
export function useOwnProvider() {
  return useQuery({
    queryKey: catalogKeys.ownProvider,
    queryFn: ({ signal }) => data(authedRequest<ProviderDto>("/providers/me", { signal })),
  });
}
const providerChanges = [catalogKeys.providers, catalogKeys.services, catalogKeys.preview];
export const useCreateProvider = () =>
  useInvalidatingMutation((body: CreateProviderInput) => data(authedRequest<ProviderDto>("/providers", { method: "POST", body })), providerChanges);
export const useUpdateProvider = (id: string) =>
  useInvalidatingMutation(
    (body: UpdateProviderInput) => data(authedRequest<ProviderDto>(`/providers/${id}`, { method: "PATCH", body })),
    providerChanges,
  );
export const useDeleteProvider = () =>
  useInvalidatingMutation((id: string) => authedRequest<void>(`/providers/${id}`, { method: "DELETE" }), providerChanges);

export interface BulkDeleteResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

/** Deletes each provider independently (the guard is per-provider: no bookings, no dashboard login) and reports which ones could not be removed. */
export function useBulkDeleteProviders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<BulkDeleteResult> => {
      const results = await Promise.allSettled(ids.map((id) => authedRequest<void>(`/providers/${id}`, { method: "DELETE" })));
      const failed: BulkDeleteResult["failed"] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded++;
        else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Could not delete" });
      });
      return { succeeded, failed };
    },
    onSuccess: () => {
      for (const key of providerChanges) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
export const useUpdateOwnProvider = () =>
  useInvalidatingMutation(
    (body: UpdateOwnProviderInput) => data(authedRequest<ProviderDto>("/providers/me", { method: "PATCH", body })),
    [catalogKeys.providers],
  );
export const useSetProviderServices = (id: string) =>
  useInvalidatingMutation(
    (serviceIds: string[]) => data(authedRequest<ProviderDto>(`/providers/${id}/services`, { method: "PUT", body: { serviceIds } })),
    providerChanges,
  );
export const useInviteProvider = (id: string) =>
  useInvalidatingMutation(
    (body: InviteProviderInput) => data(authedRequest<ProviderDto>(`/providers/${id}/invite`, { method: "POST", body })),
    [catalogKeys.providers, ["admin", "users"]],
  );

// ---- availability -------------------------------------------------------------------

export function useAvailability(providerId: string) {
  return useQuery({
    queryKey: catalogKeys.availability(providerId),
    queryFn: ({ signal }) => data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}`, { signal })),
  });
}
function useAvailabilityMutation<TInput>(providerId: string, request: (input: TInput) => Promise<AvailabilityDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (dto) => {
      qc.setQueryData(catalogKeys.availability(providerId), dto);
      void qc.invalidateQueries({ queryKey: catalogKeys.preview });
    },
  });
}
const base = (providerId: string) => `/availability/providers/${providerId}`;
export const useSaveSchedule = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: WeeklyScheduleInput) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/schedule`, { method: "PUT", body })),
  );
export const useAddException = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: CreateExceptionInput) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/exceptions`, { method: "POST", body })),
  );
export const useBulkAddExceptions = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: BulkCreateExceptionsInput) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/exceptions/bulk`, { method: "POST", body })),
  );
export const useRemoveException = (providerId: string) =>
  useAvailabilityMutation(providerId, (id: string) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/exceptions/${id}`, { method: "DELETE" })),
  );
export const useAddBlock = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: CreateBlockedSlotInput) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/blocks`, { method: "POST", body })),
  );
export const useRemoveBlock = (providerId: string) =>
  useAvailabilityMutation(providerId, (id: string) =>
    data(authedRequest<AvailabilityDto>(`${base(providerId)}/blocks/${id}`, { method: "DELETE" })),
  );

export function useHolidays() {
  return useQuery({
    queryKey: catalogKeys.holidays,
    queryFn: ({ signal }) => data(authedRequest<HolidayDto[]>("/availability/holidays", { signal })),
  });
}
export const useAddHoliday = () =>
  useInvalidatingMutation(
    (body: CreateHolidayInput) => data(authedRequest<HolidayDto[]>("/availability/holidays", { method: "POST", body })),
    [catalogKeys.holidays, catalogKeys.preview],
  );
export const useRemoveHoliday = () =>
  useInvalidatingMutation(
    (id: string) => data(authedRequest<HolidayDto[]>(`/availability/holidays/${id}`, { method: "DELETE" })),
    [catalogKeys.holidays, catalogKeys.preview],
  );

// ---- slot preview (backend-computed; same engine as the booking forms) ----------------

export function useAvailableDates(query: AvailableDatesQuery | null) {
  return useQuery({
    queryKey: [...catalogKeys.preview, "dates", query],
    queryFn: ({ signal }) => data(authedRequest<AvailableDatesDto>("/availability/preview/dates", { query: query as Query, signal })),
    enabled: query !== null,
    placeholderData: keepPreviousData,
  });
}
export function useSlots(query: SlotsQuery | null) {
  return useQuery({
    queryKey: [...catalogKeys.preview, "slots", query],
    queryFn: ({ signal }) => data(authedRequest<SlotsDto>("/availability/preview/slots", { query: query as Query, signal })),
    enabled: query !== null,
  });
}
