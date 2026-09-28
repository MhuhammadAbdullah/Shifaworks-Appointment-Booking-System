/**
 * Single source of truth for permission keys and the default role matrix.
 * The API seeds these into the database and enforces them on every route;
 * the web app uses the same keys only to hide UI the user cannot use.
 *
 * Only staff and providers have accounts. Providers are additionally scoped
 * to their own appointments in the services (ownership), whatever their
 * permissions say.
 */

export const PERMISSIONS = {
  bookings: [
    "view",
    "view_all", // every provider's bookings (providers without it see only their own)
    "create", // manual bookings (phone, walk-in, admin)
    "update", // reschedule, mark completed / no-show
    "cancel",
    "delete", // hard-delete; only allowed while the booking has no payment history (see bookings.service.ts::deleteBooking)
    "override_availability", // book outside working hours (never over another booking)
    "check_in", // scan or manually look up a ticket and check the customer in
  ],
  payments: ["view", "verify", "refund", "delete"], // verify = verify / reject / mark proof received; delete = only pending/rejected, never verified/refunded
  availability: ["view", "manage_own", "manage_all"],
  services: ["view", "update", "manage_packages", "manage_concern_options"], // update = open/close, durations, buffers
  providers: ["view", "create", "update", "delete"],
  customers: ["view"],
  invoices: ["view", "create", "update", "void"],
  finance: ["view", "create", "update", "export"],
  expenses: ["view", "create", "update", "approve"],
  notifications: ["view", "send", "manage_templates"],
  staff: ["view", "create", "update", "delete"],
  roles: ["view", "manage"],
  reports: ["view", "export"],
  audit: ["view"],
  settings: ["manage"],
} as const;

type PermissionMap = typeof PERMISSIONS;
export type PermissionModule = keyof PermissionMap;
export type PermissionKey = {
  [M in PermissionModule]: `${M}.${PermissionMap[M][number]}`;
}[PermissionModule];

export const ALL_PERMISSIONS: readonly PermissionKey[] = (Object.entries(PERMISSIONS) as [PermissionModule, readonly string[]][]).flatMap(
  ([module, actions]) => actions.map((a) => `${module}.${a}` as PermissionKey),
);

export const ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "RECEPTIONIST", "FINANCE_STAFF", "THERAPIST", "COUNSELLOR"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STAFF_ROLE_KEYS: readonly RoleKey[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "RECEPTIONIST", "FINANCE_STAFF"];
export const PROVIDER_ROLE_KEYS: readonly RoleKey[] = ["THERAPIST", "COUNSELLOR"];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  RECEPTIONIST: "Reception",
  FINANCE_STAFF: "Finance",
  THERAPIST: "Therapist",
  COUNSELLOR: "Counsellor",
};

const moduleAll = (m: PermissionModule): PermissionKey[] => PERMISSIONS[m].map((a) => `${m}.${a}` as PermissionKey);
const allExcept = (...excluded: PermissionKey[]): PermissionKey[] => ALL_PERMISSIONS.filter((p) => !excluded.includes(p));

const PROVIDER_PERMISSIONS: readonly PermissionKey[] = [
  "bookings.view", // own appointments only (ownership enforced in services)
  "bookings.update", // mark own appointments completed / no-show
  "availability.view",
  "availability.manage_own",
  "services.view",
];

/**
 * Default permissions per system role. SUPER_ADMIN bypasses checks in the API
 * but is still granted everything explicitly for transparency. Admins can
 * adjust role permissions later (Staff → Roles); these are only the defaults.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: allExcept("roles.manage"),
  MANAGER: [
    ...moduleAll("bookings"),
    "payments.view",
    "payments.verify",
    ...moduleAll("availability"),
    ...moduleAll("services"),
    ...moduleAll("providers"),
    "customers.view",
    "invoices.view",
    "invoices.create",
    "finance.view",
    "expenses.view",
    "expenses.create",
    "notifications.view",
    "notifications.send",
    "staff.view",
    ...moduleAll("reports"),
    "audit.view",
  ],
  RECEPTIONIST: [
    "bookings.view",
    "bookings.view_all",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.delete",
    "bookings.check_in",
    "payments.view",
    "payments.verify",
    "availability.view",
    "services.view",
    "providers.view",
    "customers.view",
    "invoices.view",
    "invoices.create",
    "notifications.view",
    "notifications.send",
  ],
  FINANCE_STAFF: [
    "bookings.view",
    "bookings.view_all",
    ...moduleAll("payments"),
    "customers.view",
    ...moduleAll("invoices"),
    ...moduleAll("finance"),
    ...moduleAll("expenses"),
    ...moduleAll("reports"),
  ],
  THERAPIST: PROVIDER_PERMISSIONS,
  COUNSELLOR: PROVIDER_PERMISSIONS,
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
