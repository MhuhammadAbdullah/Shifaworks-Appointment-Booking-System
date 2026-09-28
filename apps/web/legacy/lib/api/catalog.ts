"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  CategoryDto,
  CreateCategoryInput,
  CreateCustomerInput,
  CreateLocationInput,
  CreateProviderInput,
  CreateServiceInput,
  CustomerDetail,
  CustomerListItem,
  FileDto,
  ListCategoriesQuery,
  ListCustomersQuery,
  ListProvidersQuery,
  ListServicesQuery,
  ListStaffQuery,
  LocationDto,
  ProviderDto,
  ServiceDto,
  SetServiceProvidersInput,
  StaffListItem,
  UpdateCategoryInput,
  UpdateCustomerInput,
  UpdateLocationInput,
  UpdateOwnCustomerInput,
  UpdateOwnProviderInput,
  UpdateProviderInput,
  UpdateServiceInput,
  UpdateStaffProfileInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

type Query = Record<string, string | number | boolean | undefined>;

export const catalogKeys = {
  locations: ["catalog", "locations"] as const,
  categories: ["catalog", "categories"] as const,
  services: ["catalog", "services"] as const,
  service: (id: string) => ["catalog", "services", id] as const,
  providers: ["catalog", "providers"] as const,
  provider: (id: string) => ["catalog", "providers", id] as const,
  ownProvider: ["catalog", "providers", "me"] as const,
  customers: ["catalog", "customers"] as const,
  customer: (id: string) => ["catalog", "customers", id] as const,
  ownCustomer: ["catalog", "customers", "me"] as const,
  staff: ["catalog", "staff"] as const,
};

/** Mutation that refreshes every query under the given key prefixes. */
function useInvalidatingMutation<TInput, TResult>(
  request: (input: TInput) => Promise<TResult>,
  invalidate: QueryKey[],
) {
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

// ---- locations --------------------------------------------------------------------

export function useLocations() {
  return useQuery({
    queryKey: catalogKeys.locations,
    queryFn: ({ signal }) => data(authedRequest<LocationDto[]>("/locations", { signal })),
    staleTime: 5 * 60_000,
  });
}
export const useCreateLocation = () =>
  useInvalidatingMutation(
    (body: CreateLocationInput) => data(authedRequest<LocationDto>("/locations", { method: "POST", body })),
    [catalogKeys.locations],
  );
export const useUpdateLocation = () =>
  useInvalidatingMutation(
    ({ id, body }: { id: string; body: UpdateLocationInput }) =>
      data(authedRequest<LocationDto>(`/locations/${id}`, { method: "PATCH", body })),
    [catalogKeys.locations],
  );
export const useDeleteLocation = () =>
  useInvalidatingMutation(
    (id: string) => authedRequest<void>(`/locations/${id}`, { method: "DELETE" }),
    [catalogKeys.locations],
  );

// ---- categories -------------------------------------------------------------------

export function useCategories(query: Partial<ListCategoriesQuery> = {}) {
  return useQuery({
    queryKey: [...catalogKeys.categories, query],
    queryFn: ({ signal }) => data(authedRequest<CategoryDto[]>("/categories", { query: query as Query, signal })),
  });
}
export const useCreateCategory = () =>
  useInvalidatingMutation(
    (body: CreateCategoryInput) => data(authedRequest<CategoryDto>("/categories", { method: "POST", body })),
    [catalogKeys.categories],
  );
export const useUpdateCategory = () =>
  useInvalidatingMutation(
    ({ id, body }: { id: string; body: UpdateCategoryInput }) =>
      data(authedRequest<CategoryDto>(`/categories/${id}`, { method: "PATCH", body })),
    [catalogKeys.categories, catalogKeys.services],
  );
export const useReorderCategories = () =>
  useInvalidatingMutation(
    (ids: string[]) => data(authedRequest<CategoryDto[]>("/categories/order", { method: "PUT", body: { ids } })),
    [catalogKeys.categories],
  );
export const useDeleteCategory = () =>
  useInvalidatingMutation(
    (id: string) => authedRequest<void>(`/categories/${id}`, { method: "DELETE" }),
    [catalogKeys.categories],
  );

// ---- services ---------------------------------------------------------------------

export function useServices(query: Partial<ListServicesQuery>) {
  return useQuery({
    queryKey: [...catalogKeys.services, query],
    queryFn: ({ signal }) => authedRequest<ServiceDto[]>("/services", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useService(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.service(id ?? ""),
    queryFn: ({ signal }) => data(authedRequest<ServiceDto>(`/services/${id}`, { signal })),
    enabled: Boolean(id),
  });
}
export const useCreateService = () =>
  useInvalidatingMutation(
    (body: CreateServiceInput) => data(authedRequest<ServiceDto>("/services", { method: "POST", body })),
    [catalogKeys.services, catalogKeys.categories, catalogKeys.providers],
  );
export const useUpdateService = (id: string) =>
  useInvalidatingMutation(
    (body: UpdateServiceInput) => data(authedRequest<ServiceDto>(`/services/${id}`, { method: "PATCH", body })),
    [catalogKeys.services],
  );
export const useSetServiceProviders = (id: string) =>
  useInvalidatingMutation(
    (body: SetServiceProvidersInput) =>
      data(authedRequest<ServiceDto>(`/services/${id}/providers`, { method: "PUT", body })),
    [catalogKeys.services, catalogKeys.providers],
  );
export const useDeleteService = () =>
  useInvalidatingMutation(
    (id: string) => authedRequest<void>(`/services/${id}`, { method: "DELETE" }),
    [catalogKeys.services, catalogKeys.categories, catalogKeys.providers],
  );

// ---- providers --------------------------------------------------------------------

export function useProviders(query: Partial<ListProvidersQuery> = {}) {
  return useQuery({
    queryKey: [...catalogKeys.providers, query],
    queryFn: ({ signal }) => authedRequest<ProviderDto[]>("/providers", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
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
export const useCreateProvider = () =>
  useInvalidatingMutation(
    (body: CreateProviderInput) => data(authedRequest<ProviderDto>("/providers", { method: "POST", body })),
    [catalogKeys.providers, catalogKeys.staff],
  );
export const useUpdateProvider = (id: string) =>
  useInvalidatingMutation(
    (body: UpdateProviderInput) => data(authedRequest<ProviderDto>(`/providers/${id}`, { method: "PATCH", body })),
    [catalogKeys.providers, catalogKeys.services],
  );
export const useUpdateOwnProvider = () =>
  useInvalidatingMutation(
    (body: UpdateOwnProviderInput) => data(authedRequest<ProviderDto>("/providers/me", { method: "PATCH", body })),
    [catalogKeys.providers],
  );
export const useSetProviderServices = (id: string) =>
  useInvalidatingMutation(
    (serviceIds: string[]) =>
      data(authedRequest<ProviderDto>(`/providers/${id}/services`, { method: "PUT", body: { serviceIds } })),
    [catalogKeys.providers, catalogKeys.services],
  );
export const useSetProviderLocations = (id: string) =>
  useInvalidatingMutation(
    (locationIds: string[]) =>
      data(authedRequest<ProviderDto>(`/providers/${id}/locations`, { method: "PUT", body: { locationIds } })),
    [catalogKeys.providers],
  );

// ---- customers --------------------------------------------------------------------

export function useCustomers(query: Partial<ListCustomersQuery>) {
  return useQuery({
    queryKey: [...catalogKeys.customers, query],
    queryFn: ({ signal }) => authedRequest<CustomerListItem[]>("/customers", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useCustomer(id: string) {
  return useQuery({
    queryKey: catalogKeys.customer(id),
    queryFn: ({ signal }) => data(authedRequest<CustomerDetail>(`/customers/${id}`, { signal })),
  });
}
export function useOwnCustomer(enabled = true) {
  return useQuery({
    queryKey: catalogKeys.ownCustomer,
    queryFn: ({ signal }) => data(authedRequest<CustomerDetail>("/customers/me", { signal })),
    enabled,
  });
}
export const useCreateCustomer = () =>
  useInvalidatingMutation(
    (body: CreateCustomerInput) => data(authedRequest<CustomerDetail>("/customers", { method: "POST", body })),
    [catalogKeys.customers],
  );
export const useUpdateCustomer = (id: string) =>
  useInvalidatingMutation(
    (body: UpdateCustomerInput) =>
      data(authedRequest<CustomerDetail>(`/customers/${id}`, { method: "PATCH", body })),
    [catalogKeys.customers, ["admin", "users"]],
  );
export const useUpdateOwnCustomer = () =>
  useInvalidatingMutation(
    (body: UpdateOwnCustomerInput) =>
      data(authedRequest<CustomerDetail>("/customers/me", { method: "PATCH", body })),
    [catalogKeys.ownCustomer],
  );

// ---- staff --------------------------------------------------------------------------

export function useStaff(query: Partial<ListStaffQuery>, enabled = true) {
  return useQuery({
    queryKey: [...catalogKeys.staff, query],
    queryFn: ({ signal }) => authedRequest<StaffListItem[]>("/staff", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
export const useUpdateStaffProfile = (userId: string) =>
  useInvalidatingMutation(
    (body: UpdateStaffProfileInput) =>
      data(authedRequest<StaffListItem>(`/staff/${userId}`, { method: "PATCH", body })),
    [catalogKeys.staff, ["admin", "user"]],
  );
