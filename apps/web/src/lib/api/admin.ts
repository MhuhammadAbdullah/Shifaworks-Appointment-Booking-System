"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateRoleInput,
  CreateUserInput,
  ListStaffQuery,
  ListUsersQuery,
  StaffListItem,
  UpdateStaffProfileInput,
  PermissionInfo,
  RoleSummary,
  SetUserPermissionsInput,
  SetUserStatusInput,
  UpdateRoleInput,
  UpdateUserInput,
  UserDetail,
  UserListItem,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";

export const adminKeys = {
  users: (q: Partial<ListUsersQuery>) => ["admin", "users", q] as const,
  usersAll: ["admin", "users"] as const,
  user: (id: string) => ["admin", "user", id] as const,
  roles: ["admin", "roles"] as const,
  permissions: ["admin", "permissions"] as const,
  staff: (q: Partial<ListStaffQuery>) => ["admin", "staff", q] as const,
  staffAll: ["admin", "staff"] as const,
};

// ---- Users --------------------------------------------------------------------

export function useUsers(query: Partial<ListUsersQuery>) {
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: ({ signal }) =>
      authedRequest<UserListItem[]>("/users", { query: query as Record<string, string | number>, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: adminKeys.user(id),
    queryFn: ({ signal }) => authedRequest<UserDetail>(`/users/${id}`, { signal }).then((r) => r.data),
  });
}

/** After any user mutation: refresh the detail cache and every list page. */
function useUserMutation<TInput>(request: (input: TInput) => Promise<UserDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (user) => {
      qc.setQueryData(adminKeys.user(user.id), user);
      void qc.invalidateQueries({ queryKey: adminKeys.usersAll });
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
    },
  });
}

export function useCreateUser() {
  return useUserMutation((body: CreateUserInput) =>
    authedRequest<UserDetail>("/users", { method: "POST", body }).then((r) => r.data),
  );
}

export function useUpdateUser(id: string) {
  return useUserMutation((body: UpdateUserInput) =>
    authedRequest<UserDetail>(`/users/${id}`, { method: "PATCH", body }).then((r) => r.data),
  );
}

export function useSetUserStatus(id: string) {
  return useUserMutation((body: SetUserStatusInput) =>
    authedRequest<UserDetail>(`/users/${id}/status`, { method: "PUT", body }).then((r) => r.data),
  );
}

export function useSetUserRoles(id: string) {
  return useUserMutation((roleIds: string[]) =>
    authedRequest<UserDetail>(`/users/${id}/roles`, { method: "PUT", body: { roleIds } }).then((r) => r.data),
  );
}

export function useSetUserPermissions(id: string) {
  return useUserMutation((body: SetUserPermissionsInput) =>
    authedRequest<UserDetail>(`/users/${id}/permissions`, { method: "PUT", body }).then((r) => r.data),
  );
}

export function useSendInvite(id: string) {
  return useUserMutation(() => authedRequest<UserDetail>(`/users/${id}/invite`, { method: "POST" }).then((r) => r.data));
}

/** Only succeeds for accounts with no activity history — the API blocks (409) otherwise and asks for a deactivation instead. */
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedRequest<void>(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.usersAll }),
  });
}

export interface BulkDeleteResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

/** Deletes each account independently (the guard is per-account: no activity history) and reports which ones could not be removed. */
export function useBulkDeleteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<BulkDeleteResult> => {
      const results = await Promise.allSettled(ids.map((id) => authedRequest<void>(`/users/${id}`, { method: "DELETE" })));
      const failed: BulkDeleteResult["failed"] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded++;
        else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Could not delete" });
      });
      return { succeeded, failed };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.usersAll }),
  });
}

// ---- Staff directory (employment details) ---------------------------------------

export function useStaff(query: Partial<ListStaffQuery>) {
  return useQuery({
    queryKey: adminKeys.staff(query),
    queryFn: ({ signal }) =>
      authedRequest<StaffListItem[]>("/staff", { query: query as Record<string, string | number>, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateStaffProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStaffProfileInput) =>
      authedRequest<StaffListItem>(`/staff/${userId}`, { method: "PATCH", body }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.staffAll });
      void qc.invalidateQueries({ queryKey: adminKeys.user(userId) });
    },
  });
}

// ---- Roles & permissions --------------------------------------------------------

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: adminKeys.roles,
    queryFn: ({ signal }) => authedRequest<RoleSummary[]>("/roles", { signal }).then((r) => r.data),
    enabled,
    staleTime: 60_000,
  });
}

export function usePermissionCatalog(enabled = true) {
  return useQuery({
    queryKey: adminKeys.permissions,
    queryFn: ({ signal }) => authedRequest<PermissionInfo[]>("/permissions", { signal }).then((r) => r.data),
    enabled,
    staleTime: Infinity,
  });
}

function useRoleMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
      void qc.invalidateQueries({ queryKey: ["admin", "user"] });
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useCreateRole() {
  return useRoleMutation((body: CreateRoleInput) =>
    authedRequest<RoleSummary>("/roles", { method: "POST", body }).then((r) => r.data),
  );
}

export function useUpdateRole() {
  return useRoleMutation(({ id, body }: { id: string; body: UpdateRoleInput }) =>
    authedRequest<RoleSummary>(`/roles/${id}`, { method: "PATCH", body }).then((r) => r.data),
  );
}

export function useDeleteRole() {
  return useRoleMutation((id: string) => authedRequest<void>(`/roles/${id}`, { method: "DELETE" }).then(() => id));
}

/** Groups the permission catalogue by module for matrix UIs. */
export function groupPermissions(perms: PermissionInfo[]): [string, PermissionInfo[]][] {
  const map = new Map<string, PermissionInfo[]>();
  for (const p of perms) map.set(p.module, [...(map.get(p.module) ?? []), p]);
  return [...map.entries()];
}

export function permissionLabel(key: string): string {
  const action = key.split(".")[1] ?? key;
  return action.replace(/_/g, " ");
}
