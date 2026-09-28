/**
 * Idempotent seed. Safe to run repeatedly: every write is an upsert or a
 * find-then-create keyed on a natural unique key, and existing values
 * (settings, prices, service status) are never overwritten.
 *
 *   npm run db:seed            (from repo root or apps/api)
 *
 * Always seeds: organisation, default location, permissions, system roles,
 * the super admin, finance/expense categories, every setting (defaults) and
 * the five ShifaWorks services (closed until an admin opens them).
 *
 * With SEED_DEMO_DATA=true (development only) it also seeds demo providers
 * with gender preferences and weekly hours, demo packages with DEMO prices,
 * and opens the five services.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import {
  ALL_PERMISSIONS,
  CLINICAL_CONCERNS,
  CLINICAL_CONCERN_LABELS,
  COACHING_AREAS,
  COACHING_AREA_LABELS,
  DEFAULT_ROLE_PERMISSIONS,
  FAITH_COUNSELING_AREAS,
  FAITH_COUNSELING_AREA_LABELS,
  ROLE_KEYS,
  ROLE_LABELS,
  SERVICE_DEFINITIONS,
  SERVICE_SLUGS,
  SETTINGS,
  type Gender,
  type ProviderType,
  type RoleKey,
  type ServiceSlug,
} from "@booking/shared";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";
import { installDefaultTemplates } from "../src/modules/notifications/templates.service.js";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL must be set to seed");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_SLUG = process.env.DEFAULT_ORGANIZATION_SLUG ?? "shifaworks";
const TZ = "Asia/Karachi";
const DEMO = (process.env.SEED_DEMO_DATA ?? "false") === "true";

const log = (msg: string) => console.log(`  • ${msg}`);

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function seedOrganization() {
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { name: "ShifaWorks", slug: ORG_SLUG, timezone: TZ, currency: "PKR", locale: "en-PK", website: "https://shifaworks.com" },
    update: {},
  });
  const location = await prisma.location.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "main" } },
    create: { organizationId: org.id, name: "ShifaWorks Clinic", slug: "main", timezone: TZ, country: "PK", isDefault: true },
    update: {},
  });
  log(`organisation "${org.name}" + location "${location.name}"`);
  return { org, location };
}

async function seedPermissionsAndRoles() {
  for (const key of ALL_PERMISSIONS) {
    const [module] = key.split(".");
    await prisma.permission.upsert({ where: { key }, create: { key, module: module! }, update: { module: module! } });
  }
  // Permissions that no longer exist in the catalogue are removed (cascades to grants).
  await prisma.permission.deleteMany({ where: { key: { notIn: [...ALL_PERMISSIONS] } } });
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

  const roles = new Map<RoleKey, string>();
  for (const key of ROLE_KEYS) {
    // System roles have organizationId = null; Prisma cannot upsert on a
    // compound unique containing null, so find-then-create.
    const existing = await prisma.role.findFirst({ where: { organizationId: null, key } });
    const role = existing ?? (await prisma.role.create({ data: { key, name: ROLE_LABELS[key], isSystem: true, organizationId: null } }));
    roles.set(key, role.id);
    if (existing) continue; // an admin may have customised an existing role's permissions
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: permissionId.get(p)! })),
      skipDuplicates: true,
    });
  }
  log(`${ALL_PERMISSIONS.length} permissions, ${ROLE_KEYS.length} system roles`);
  return roles;
}

/** Creates (or finds) the Supabase Auth user so the admin can sign in. */
async function ensureAuthUser(email: string, password: string | undefined): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("  ! SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: admin created without a login");
    return null;
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  if (!password) {
    console.warn("  ! SEED_ADMIN_PASSWORD not set: admin created without a login");
    return null;
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function seedSuperAdmin(organizationId: string, roles: Map<RoleKey, string>) {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const authUserId = await ensureAuthUser(email, process.env.SEED_ADMIN_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email },
    create: { organizationId, email, firstName: "System", lastName: "Administrator", authUserId },
    update: authUserId ? { authUserId } : {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: roles.get("SUPER_ADMIN")! } },
    create: { userId: user.id, roleId: roles.get("SUPER_ADMIN")! },
    update: {},
  });
  await prisma.staffProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, organizationId, department: "Administration", jobTitle: "Administrator" },
    update: {},
  });
  log(`super admin ${email}${authUserId ? " (linked to Supabase Auth)" : " (no login yet)"}`);
  return email;
}

async function seedFinanceCategories(organizationId: string) {
  const income = ["Appointments", "Other Income"];
  const expense = ["Rent", "Salaries", "Utilities", "Supplies", "Marketing", "Software", "Maintenance", "Other"];
  const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");
  for (const name of income) {
    await prisma.financeCategory.upsert({
      where: { organizationId_type_slug: { organizationId, type: "INCOME", slug: slug(name) } },
      create: { organizationId, type: "INCOME", name, slug: slug(name) },
      update: {},
    });
  }
  for (const name of expense) {
    await prisma.financeCategory.upsert({
      where: { organizationId_type_slug: { organizationId, type: "EXPENSE", slug: slug(name) } },
      create: { organizationId, type: "EXPENSE", name, slug: slug(name) },
      update: {},
    });
    await prisma.expenseCategory.upsert({
      where: { organizationId_slug: { organizationId, slug: slug(name) } },
      create: { organizationId, name, slug: slug(name) },
      update: {},
    });
  }
  log("finance + expense categories");
}

/** Built-in email templates; never overwrites one an admin has edited. */
async function seedEmailTemplates(organizationId: string) {
  const { created } = await installDefaultTemplates(prisma, organizationId);
  log(`email templates (${created} created)`);
}

/** Every setting gets a row with its default; existing values are never changed. */
async function seedSettings(organizationId: string, adminEmail: string) {
  for (const [name, d] of Object.entries(SETTINGS)) {
    // New booking requests go to the super admin until the admin list is edited.
    const value = (name === "adminEmails" ? [adminEmail] : d.default) as Prisma.InputJsonValue;
    await prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId, key: d.key } },
      create: { organizationId, key: d.key, value, description: d.description },
      update: { description: d.description },
    });
  }
  log(`${Object.keys(SETTINGS).length} settings (support contacts and payment details are empty until an admin fills them in)`);
}

const SERVICE_TIMING: Record<ServiceSlug, { bufferAfterMinutes: number }> = {
  "hijama-therapy": { bufferAfterMinutes: 15 },
  "speech-therapy": { bufferAfterMinutes: 15 },
  "islamic-life-coaching": { bufferAfterMinutes: 15 },
  "faith-based-counseling": { bufferAfterMinutes: 15 },
  "clinical-counseling": { bufferAfterMinutes: 15 },
};

async function seedServices(organizationId: string) {
  const ids = new Map<ServiceSlug, string>();
  for (const [i, slug] of SERVICE_SLUGS.entries()) {
    const d = SERVICE_DEFINITIONS[slug];
    const row = await prisma.service.upsert({
      where: { organizationId_slug: { organizationId, slug } },
      create: {
        organizationId,
        slug,
        name: d.name,
        description: d.description,
        providerType: d.providerType,
        defaultDurationMinutes: d.defaultDurationMinutes,
        bufferAfterMinutes: SERVICE_TIMING[slug].bufferAfterMinutes,
        // Closed until an admin opens it (open immediately in demo mode).
        isActive: DEMO,
        bookingEnabled: true,
        sortOrder: i,
      },
      update: {},
    });
    ids.set(slug, row.id);
  }
  log(`${SERVICE_SLUGS.length} services${DEMO ? " (open, demo mode)" : " (closed until an admin opens them)"}`);
  return ids;
}

/**
 * Initial rows for each service's admin-manageable "Areas of concern" style
 * checklist (Services -> admin) — seeded once from the values this feature
 * used to hard-code; never overwrites a row an admin has since edited.
 */
const CONCERN_SEED: Partial<Record<ServiceSlug, { code: string; label: string }[]>> = {
  "clinical-counseling": CLINICAL_CONCERNS.filter((c) => c !== "OTHER").map((c) => ({ code: c, label: CLINICAL_CONCERN_LABELS[c] })),
  "faith-based-counseling": FAITH_COUNSELING_AREAS.filter((c) => c !== "OTHER").map((c) => ({ code: c, label: FAITH_COUNSELING_AREA_LABELS[c] })),
  "islamic-life-coaching": COACHING_AREAS.filter((c) => c !== "OTHER").map((c) => ({ code: c, label: COACHING_AREA_LABELS[c] })),
};

async function seedConcernOptions(serviceIds: Map<ServiceSlug, string>) {
  let count = 0;
  for (const [slug, options] of Object.entries(CONCERN_SEED) as [ServiceSlug, { code: string; label: string }[]][]) {
    const serviceId = serviceIds.get(slug);
    if (!serviceId) continue;
    for (const [i, opt] of options.entries()) {
      await prisma.serviceConcernOption.upsert({
        where: { serviceId_code: { serviceId, code: opt.code } },
        create: { serviceId, code: opt.code, label: opt.label, sortOrder: i },
        update: {},
      });
      count++;
    }
  }
  log(`${count} concern-checklist options (clinical/faith-based counseling, life coaching)`);
}

// ---------------------------------------------------------------------------
// Demo data (development only)
// ---------------------------------------------------------------------------

interface DemoProvider {
  slug: string;
  name: string;
  type: ProviderType;
  gender: Gender;
  designation: string;
  experienceYears: number;
  rating: number;
  acceptsMale: boolean;
  acceptsFemale: boolean;
  specializations: string[];
  services: ServiceSlug[];
}

const DEMO_PROVIDERS: DemoProvider[] = [
  {
    slug: "hayyan-marfani",
    name: "HK. Hayyan Marfani",
    type: "THERAPIST",
    gender: "MALE",
    designation: "Hijama Therapist",
    experienceYears: 8,
    rating: 4.9,
    acceptsMale: true,
    acceptsFemale: false,
    specializations: ["Sunnah Hijama", "Sciatica", "Back pain"],
    services: ["hijama-therapy"],
  },
  {
    slug: "maryam-siddiqui",
    name: "HK. Maryam Siddiqui",
    type: "THERAPIST",
    gender: "FEMALE",
    designation: "Hijama Therapist",
    experienceYears: 6,
    rating: 4.8,
    acceptsMale: false,
    acceptsFemale: true,
    specializations: ["Sunnah Hijama", "Women's wellness"],
    services: ["hijama-therapy"],
  },
  {
    slug: "sana-iqbal",
    name: "Sana Iqbal",
    type: "THERAPIST",
    gender: "FEMALE",
    designation: "Speech & Language Therapist",
    experienceYears: 7,
    rating: 4.9,
    acceptsMale: true,
    acceptsFemale: true,
    specializations: ["Stuttering", "Language delay", "Articulation"],
    services: ["speech-therapy"],
  },
  {
    slug: "usman-farooq",
    name: "Dr. Usman Farooq",
    type: "COUNSELLOR",
    gender: "MALE",
    designation: "Clinical Psychologist",
    experienceYears: 10,
    rating: 4.8,
    acceptsMale: true,
    acceptsFemale: true,
    specializations: ["Anxiety", "Depression", "Trauma"],
    services: ["clinical-counseling", "faith-based-counseling"],
  },
  {
    slug: "aisha-rahman",
    name: "Aisha Rahman",
    type: "COUNSELLOR",
    gender: "FEMALE",
    designation: "Islamic Life Coach & Counsellor",
    experienceYears: 5,
    rating: 4.7,
    acceptsMale: false,
    acceptsFemale: true,
    specializations: ["Marriage & family", "Personal growth", "Spiritual development"],
    services: ["islamic-life-coaching", "faith-based-counseling"],
  },
];

/** Priced options per service. Prices are DEMO values — set real prices in Admin → Services. */
const DEMO_PACKAGES: Record<ServiceSlug, { name: string; description: string; points?: number; durationMinutes: number; price: number }[]> = {
  "hijama-therapy": [
    {
      name: "Sciatic Support Package",
      description: "Targeted Hijama support for individuals experiencing sciatic pain and discomfort.",
      points: 15,
      durationMinutes: 60,
      price: 6500,
    },
    {
      name: "Holistic Wellness Package",
      description: "A holistic 12-point package focused on immunity, brain health, stress, liver, gut, kidney and lower-back health.",
      points: 12,
      durationMinutes: 60,
      price: 5500,
    },
  ],
  "speech-therapy": [
    { name: "Initial Assessment", description: "A full speech and language assessment with recommendations.", durationMinutes: 60, price: 4000 },
    { name: "Therapy Session", description: "A one-to-one therapy session.", durationMinutes: 45, price: 3000 },
  ],
  "islamic-life-coaching": [{ name: "Coaching Session", description: "A one-to-one coaching session.", durationMinutes: 60, price: 4000 }],
  "faith-based-counseling": [{ name: "Individual Session", description: "A one-to-one counselling session.", durationMinutes: 60, price: 3500 }],
  "clinical-counseling": [
    { name: "Initial Consultation", description: "First session: assessment and plan.", durationMinutes: 60, price: 5000 },
    { name: "Follow-up Session", description: "A follow-up counselling session.", durationMinutes: 50, price: 4500 },
  ],
};

async function seedDemo(organizationId: string, locationId: string, serviceIds: Map<ServiceSlug, string>) {
  const h = (hh: number, mm = 0) => hh * 60 + mm;
  for (const [i, p] of DEMO_PROVIDERS.entries()) {
    const provider = await prisma.providerProfile.upsert({
      where: { organizationId_slug: { organizationId, slug: p.slug } },
      create: {
        organizationId,
        slug: p.slug,
        displayName: p.name,
        providerType: p.type,
        gender: p.gender,
        designation: p.designation,
        experienceYears: p.experienceYears,
        rating: p.rating,
        acceptsMale: p.acceptsMale,
        acceptsFemale: p.acceptsFemale,
        specializations: p.specializations,
        bio: `${p.designation} with ${p.experienceYears} years of experience.`,
        sortOrder: i,
      },
      update: {},
    });
    await prisma.providerLocation.upsert({
      where: { providerId_locationId: { providerId: provider.id, locationId } },
      create: { providerId: provider.id, locationId },
      update: {},
    });
    await prisma.serviceProvider.createMany({
      data: p.services.map((s) => ({ serviceId: serviceIds.get(s)!, providerId: provider.id })),
      skipDuplicates: true,
    });
    // Weekly hours: Mon 09:00-13:00 + 14:00-18:00 | Tue off | Wed 10:00-16:00 | Thu-Sat 09:00-17:00
    const existing = await prisma.availability.findFirst({ where: { providerId: provider.id, isDefault: true } });
    if (!existing) {
      await prisma.availability.create({
        data: {
          providerId: provider.id,
          locationId,
          timezone: TZ,
          isDefault: true,
          rules: {
            create: [
              { dayOfWeek: 1, startMinute: h(9), endMinute: h(13) },
              { dayOfWeek: 1, startMinute: h(14), endMinute: h(18) },
              { dayOfWeek: 3, startMinute: h(10), endMinute: h(16) },
              { dayOfWeek: 4, startMinute: h(9), endMinute: h(17) },
              { dayOfWeek: 5, startMinute: h(9), endMinute: h(17) },
              { dayOfWeek: 6, startMinute: h(9), endMinute: h(17) },
            ],
          },
        },
      });
    }
  }

  for (const slug of SERVICE_SLUGS) {
    const serviceId = serviceIds.get(slug)!;
    if (await prisma.servicePackage.count({ where: { serviceId } })) continue;
    await prisma.servicePackage.createMany({
      data: DEMO_PACKAGES[slug].map((pkg, i) => ({ serviceId, ...pkg, sortOrder: i })),
    });
  }

  log(`demo: ${DEMO_PROVIDERS.length} providers (no logins), packages with DEMO prices`);
}

async function main() {
  console.log("Seeding database…");
  const { org, location } = await seedOrganization();
  const roles = await seedPermissionsAndRoles();
  const adminEmail = await seedSuperAdmin(org.id, roles);
  await seedFinanceCategories(org.id);
  await seedEmailTemplates(org.id);
  await seedSettings(org.id, adminEmail);
  const serviceIds = await seedServices(org.id);
  await seedConcernOptions(serviceIds);
  if (DEMO) await seedDemo(org.id, location.id, serviceIds);
  console.log("Seed complete.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
