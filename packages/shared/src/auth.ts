import { z } from "zod";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./api.js";
import { PROVIDER_ROLE_KEYS, type PermissionKey } from "./permissions.js";
import { USER_STATUSES, type ProviderType, type UserStatus } from "./enums.js";
import {
  RECORD_STATUSES,
  emailSchema,
  optionalText,
  paginationQuerySchema,
  phoneSchema,
  timezoneSchema,
  type RecordStatus,
} from "./validation.js";

// Only staff and providers (therapists, counsellors) have accounts. Customers
// never log in: accounts are created by invitation and there is no sign-up.

// ---------------------------------------------------------------------------
// Response contracts
// ---------------------------------------------------------------------------

export interface MeResponse {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string;
    lastName: string | null;
    status: UserStatus;
    locale: string | null;
    timezone: string | null;
  };
  organization: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
  /** Role keys: system keys (RoleKey) or custom organisation role keys. */
  roles: string[];
  permissions: PermissionKey[];
  isSuperAdmin: boolean;
  staffProfileId: string | null;
  providerProfileId: string | null;
  providerType: ProviderType | null;
  /** The provider's own profile photo, if they have one set — null for staff (no avatar upload yet). */
  avatarUrl: string | null;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionKey[];
  userCount: number;
}

export interface PermissionInfo {
  id: string;
  key: PermissionKey;
  module: string;
  description: string | null;
}

export interface UserListItem {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: UserStatus;
  roles: { id: string; key: string; name: string }[];
  hasLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** From the staff profile — null for providers (they don't have one) and staff who haven't set it. */
  department: string | null;
  joiningDate: string | null;
}

export interface UserDetail extends UserListItem {
  permissionOverrides: { key: PermissionKey; granted: boolean }[];
  effectivePermissions: PermissionKey[];
  staffProfile: {
    id: string;
    employeeCode: string | null;
    department: string | null;
    jobTitle: string | null;
    joiningDate: string | null;
  } | null;
  providerProfile: { id: string; providerType: ProviderType; displayName: string } | null;
}

// ---------------------------------------------------------------------------
// Request schemas (validated by the API, reused by forms in the web app)
// ---------------------------------------------------------------------------

export const personNameSchema = z.string().trim().min(1, "Required").max(80);
const name = personNameSchema;
const optionalName = z.string().trim().max(80).optional().nullable();
const isoDate = z.iso.date("Use YYYY-MM-DD");

export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(128)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateMeSchema = z
  .object({
    firstName: name,
    lastName: optionalName,
    phone: phoneSchema.nullable(),
    locale: z.string().max(16).nullable(),
    timezone: timezoneSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const USER_KINDS = ["staff", "provider", "all"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().max(100).optional(),
  role: z.string().trim().max(64).optional(),
  status: z.enum(USER_STATUSES).optional(),
  /** staff = has a staff role; provider = therapist/counsellor logins */
  kind: z.enum(USER_KINDS).default("all"),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * Creates a staff account. Therapist/counsellor logins are created from their
 * provider profile (Providers → Invite), which links the login to the profile.
 */
export const createUserSchema = z
  .object({
    firstName: name,
    lastName: optionalName,
    email: emailSchema,
    phone: phoneSchema.optional(),
    roleIds: z.array(z.uuid()).min(1, "Select at least one role").max(10),
    /** Creates the login now and emails the credentials below; off = no login yet. */
    sendInvite: z.boolean().default(true),
    /** Required when sendInvite is true — the admin sets the account's initial password. */
    password: passwordSchema.optional(),
    department: z.string().trim().max(80).optional(),
    jobTitle: z.string().trim().max(80).optional(),
  })
  .refine((v) => !v.sendInvite || v.password, { path: ["password"], message: "Set a password for this account" });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: name,
    lastName: optionalName,
    phone: phoneSchema.nullable(),
    /** Staff accounts only. */
    department: z.string().trim().max(80).nullable(),
    jobTitle: z.string().trim().max(80).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  reason: z.string().trim().max(500).optional(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const setUserRolesSchema = z.object({
  roleIds: z.array(z.uuid()).max(10),
});
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

export const setUserPermissionsSchema = z.object({
  overrides: z.array(z.object({ key: z.string().min(1).max(100), granted: z.boolean() })).max(200),
});
export type SetUserPermissionsInput = z.infer<typeof setUserPermissionsSchema>;

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{2,39}$/, "3-40 chars: letters, digits, underscore"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().min(1).max(100)).max(200).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).nullable(),
    permissions: z.array(z.string().min(1).max(100)).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const idParamSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Staff directory (employment details; accounts are managed through /users)
// ---------------------------------------------------------------------------

export interface StaffListItem {
  userId: string;
  staffProfileId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  userStatus: UserStatus;
  roles: { key: string; name: string }[];
  employeeCode: string | null;
  department: string | null;
  jobTitle: string | null;
  joiningDate: string | null;
  primaryLocation: { id: string; name: string } | null;
  status: RecordStatus;
}

export const updateStaffProfileSchema = z
  .object({
    employeeCode: z.string().trim().max(40).nullable().optional(),
    department: optionalText(80),
    jobTitle: optionalText(80),
    joiningDate: isoDate.nullable().optional(),
    primaryLocationId: z.uuid().nullable().optional(),
    status: z.enum(RECORD_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateStaffProfileInput = z.infer<typeof updateStaffProfileSchema>;

export const listStaffQuerySchema = paginationQuerySchema.extend({
  department: z.string().trim().max(80).optional(),
  role: z.string().trim().max(64).optional(),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type AppArea = "admin" | "provider";

/**
 * Where to send a user after sign-in: anyone with a staff role (or Super
 * Admin) goes to /admin; therapists/counsellors with a profile go to
 * /provider. Returns null for an account with neither (no access).
 */
export function homeAreaFor(me: Pick<MeResponse, "roles" | "isSuperAdmin" | "providerProfileId">): AppArea | null {
  const providerRoles = new Set<string>(PROVIDER_ROLE_KEYS);
  if (me.isSuperAdmin || me.roles.some((r) => !providerRoles.has(r))) return "admin";
  if (me.providerProfileId) return "provider";
  return null;
}
