# ShifaWorks Booking

The booking and management layer for ShifaWorks. The WordPress site (shifaworks.com) is where people
discover services; its "Book Appointment" buttons link straight to one dedicated form per service:

| Booking URL | Service |
| ----------- | ------- |
| `/hijama-therapy` | Hijama Therapy |
| `/speech-therapy` | Speech Therapy |
| `/islamic-life-coaching` | Islamic Life Coaching |
| `/faith-based-counseling` | Faith-Based Counseling |
| `/clinical-counseling` | Clinical Counseling |

Customers never create an account: they fill in a 3-step form (personal/provider/package details →
date & time → review & payment), see the payment instructions right there in the review step, and can
optionally attach a payment receipt before submitting — otherwise they pay afterwards (bank transfer /
JazzCash / Easypaisa) and send the screenshot on WhatsApp. Either way, staff verify the payment, which
confirms the booking and emails a branded digital ticket with a QR code for check-in. Staff and
therapists/counsellors use `/admin` and `/provider`; staff also use `/admin/check-in` to scan or
manually look up a ticket at the door.

- **Web**: Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui, TanStack Query, React Hook Form + Zod
- **API**: Express 5, TypeScript, Prisma 7 (pg driver adapter), Zod 4, pino; BullMQ optional
- **Platform**: Supabase PostgreSQL, Auth (staff and providers only) and Storage

Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (architecture, ERD, API contract, booking
lifecycle, slot algorithm, email workflow, admin/provider workflows, routes, phases).

## Status

Built phase by phase (see the table at the end of the architecture document).

**Phase 1 (done):** architecture, ERD, database design, Prisma schema, migrations, seed, project
structure and environment configuration. The development database runs the new schema.

**Phase 2 (done):** staff/provider authentication and access control.

- Sign-in at `/login` with Supabase Auth. Accounts are **invite-only**: the API resolves a signed-in
  person only if an administrator created their account. There is no self-registration, and customers
  never get an account.
- Accounts without a role, and suspended or deactivated accounts, are refused.
- Also available: `/forgot-password`, invitation and reset links (`/auth/confirm`, `/auth/callback`
  → `/account/set-password`), and `/account/profile`.
- The admin shell uses the ShifaWorks sidebar (Dashboard, Bookings, Services, Providers, Finance,
  Staff, Notifications, Settings). Items from later phases are shown greyed out as "Soon".
- Staff → **Accounts & access** (`/admin/users`): invite staff, edit details, assign roles, set
  per-user permission overrides, suspend or deactivate. Staff → **Roles & permissions**
  (`/admin/roles`). Employment details are at `/admin/staff`.
- Therapist and counsellor logins are invited from their provider profile (Phase 3).

**Phase 3 (done):** services, packages, providers, availability and slot generation.

- **Services → the five services**: open or close each form (active + accepting bookings), set its
  name, description, duration, buffers, start interval, minimum notice and how far ahead customers
  can book. Also choose which providers appear on it, and manage its packages or session types
  (name, cup points for Hijama, duration, price, shown or hidden). Booked packages can only be
  hidden, not deleted.
- **Providers** (`/admin/providers`, Therapists / Counsellors tabs):
  - profile card fields: photo, name, designation, experience, rating, gender, which genders they
    accept, specialisations, bio, email, phone, active flag;
  - which services they offer;
  - an optional dashboard login, sent with **Send invitation**.
  Gender filtering (`GET /providers?gender=`) happens on the server.
- **Availability** (Providers → Availability, or a provider's Availability tab):
  - weekly hours, where breaks are the gaps between ranges;
  - specific dates with custom hours;
  - day off, leave and holiday dates;
  - one-off blocked time;
  - clinic-wide holidays.
  A preview shows exactly the dates and times the backend will offer.
- **Provider area** `/provider`: a provider edits their own availability and profile card and sees
  only their own records.
- Slots come only from the backend engine. It uses the service timing and package duration, and
  subtracts leave, holidays, blocked time and slot-holding bookings (the same statuses as the
  database exclusion constraint).

**Phase 4 (done):** the five dedicated booking forms and the `/public/*` endpoints they call.

- `/hijama-therapy`, `/speech-therapy`, `/islamic-life-coaching`, `/faith-based-counseling`,
  `/clinical-counseling` are live, built-in-code forms (no form builder): Personal → Location →
  Provider (gender-filtered) → Package/session type → Date & time → Service details → Review &
  terms → success, one shared `BookingWizard` component driven by each service's own Zod schema and
  "Service details" step (`packages/shared/src/service-forms/`, `apps/web/src/components/booking/`).
  A closed service shows "Registration Closed" with the support contacts instead of the form.
  `/hijama-therapy` … `/clinical-counseling` bypass the Supabase session check in `proxy.ts`
  entirely — they never need one.
- `/api/v1/public/*` (no login; its own rate limit — `PUBLIC_BOOKING_LIMIT_PER_HOUR`, 10/hour/IP, on
  submissions only): service bootstrap, gender-filtered providers, and the same slot search staff
  preview in Phase 3 uses (`resolveSlotPlan` / `generateSlots`), so search and booking can never
  disagree. `POST /public/bookings` creates the customer (matched by email, or created), the booking
  with its snapshot, the appointment and a `PENDING` payment in one transaction, honouring an
  `Idempotency-Key` header and a server-side honeypot field. Built as
  `modules/appointments/booking-engine.ts` (`createAppointmentBooking`), the same function Phase 5's
  manual/staff booking will call with `online: false`.
- Double-booking protection is real, not simulated: the exclusion constraint from Phase 1 is the
  final guarantee, exercised by a concurrent-submission integration test (two simultaneous requests
  for the same slot → exactly one booking, one `409 SLOT_UNAVAILABLE`).
- Payment verification, status transitions and confirmation/received emails are **not** built yet
  (Phases 6–7): a submission always lands as `PENDING_PAYMENT` / `PENDING` and the success screen
  shows the payment instructions inline; nothing is emailed yet.

**Phase 5 (done):** manual/staff booking, cancel/reschedule/complete/no-show, and the admin +
provider booking screens — all on the exact same `createAppointmentBooking` engine Phase 4 built.

- **`/admin/bookings`** (All / Pending Payment / Confirmed / Cancelled / Completed tabs, plus service,
  provider and search filters) and **`/admin/bookings/[id]`**: full detail — customer, appointment,
  payment, the answers submitted with the online form (if any), internal notes (staff-only, editable)
  — with Cancel, Reschedule, Complete and No-show actions, each shown only when the status and the
  signed-in user's permissions allow it.
- **`/admin/bookings/new`**: phone/walk-in booking. Service → provider → package → date & time (same
  backend engine as the public forms, no minimum-notice limit for staff) → customer details → how it
  was booked → optional **"Already paid"** (records the payment `VERIFIED` and, when
  `booking.autoConfirmOnVerify` is on, starts the booking `CONFIRMED` directly — see §5 of the
  architecture doc for exactly what this does and doesn't do yet).
- **Reschedule** moves a booking to a new time and/or provider: the old appointment becomes
  `RESCHEDULED` (freeing its slot) and a new one takes its place, atomically, with the same double-
  booking guarantee as creating a booking — exercised by its own concurrent-request integration test.
  Staff only (`bookings.view_all`); Complete/No-show are also open to the appointment's own provider,
  and only once the appointment's start time has passed.
- **`/provider/appointments`** and **`/provider/appointments/[id]`**: the same list/detail views,
  scoped server-side to the provider's own appointments — a provider that tries to open another
  provider's booking by URL gets a 404, not a 403 (consistent with never revealing bookings outside
  their scope). Providers can Complete/No-show their own; Reschedule and Cancel stay staff-only.
- The admin and provider dashboards now show a real "Pending payment" list and "Today's appointments",
  reading `/bookings` with `status`/`from`/`to` filters.
- Customer-facing emails ("Booking Confirmed", etc.) landed in Phase 7.

**Phase 6 (done):** payment verification, invoices and the finance ledger — all still manual (no
online gateway): a Payment row is created `PENDING` with every booking, and staff verify it after the
customer sends proof.

- **`/admin/payments`** (status/method filters, search) and **`/admin/payments/[id]`**: **Mark
  submitted** (records that proof arrived, `PENDING_PAYMENT` → `PAYMENT_SUBMITTED`, payment stays
  `PENDING`), **Verify** (method, transaction reference, optional proof upload → payment `VERIFIED`,
  booking `CONFIRMED` or `PAYMENT_VERIFIED` per the `booking.autoConfirmOnVerify` setting, and an
  `INCOME` row posted to the finance ledger), **Reject** (reason; booking goes back to
  `PENDING_PAYMENT` and a **fresh `PENDING` payment is opened** so the customer can pay again — there
  is never more than one *live* payment per booking), **Refund** (up to the unrefunded balance; posts
  a `REFUND` ledger row; a full refund moves the payment to `REFUNDED`, a partial one stays `VERIFIED`
  with `refundedAmount` set). "Paid at the desk" manual bookings (Phase 5) now also post their `INCOME`
  row at booking time. A booking sitting at `PAYMENT_VERIFIED` (payment verified but
  `autoConfirmOnVerify` is off) gets a **Confirm** button on its own detail page
  (`POST /bookings/:id/confirm`) — the one lifecycle edge the Payments API itself doesn't cover.
- **`/admin/invoices`**, **`/admin/invoices/[id]`** (PDF, Issue, Void) and a **Raise invoice** button
  on a confirmed/completed booking's detail page (idempotent — re-raising returns the existing one; an
  already-verified payment counts towards it immediately). Manual invoices (arbitrary customer + line
  items, tax/discount per line) are supported by the API but have no admin page yet — the practical
  path is always from a booking.
- **`/admin/finance`** (income/expenses/refunds/adjustments/net + outstanding for a date range, by
  method and by category) and **`/admin/finance/transactions`** (the ledger: everything payments,
  refunds and paid expenses post automatically, plus a manual-entry dialog for anything else — CSV
  export). **`/admin/expenses`** and **`/admin/expenses/[id]`**: draft → approved/rejected → paid
  (marking paid posts the `EXPENSE` ledger row); approving/rejecting needs `expenses.approve` and is
  refused for your own expense unless you're a Super Admin (separation of duties).
- Payment proofs and expense receipts upload to a **private** Supabase bucket (`POST /files/private`,
  magic-byte checked: JPEG/PNG/WebP/PDF) and are only ever viewed through a **short-lived signed URL**
  (`GET /files/private/:id/url`) generated on demand — never a public link, never baked into a list
  response.
- Still not built: online payment gateways (never will be — manual verification is the deliberate
  design, ARCHITECTURE.md §0), a customer-facing invoice view (customers have no accounts), and a
  manual-invoice creation page (no customer directory to pick from yet).

**Phase 7 (done):** the email system — an outbox, editable templates, delivery with retries, and the
admin log. Still no online payment gateways, no in-app inbox (no customer accounts to own one) and no
automated WhatsApp — the architecture never called for either (§0, §7); WhatsApp stays a "Chat on
WhatsApp" button.

- Every booking-lifecycle transaction now queues its email in the **same transaction** as the change:
  submission (`BOOKING_RECEIVED` to customer + admin; "paid at the desk" sends the customer
  `BOOKING_CONFIRMED` instead and admin still gets `BOOKING_RECEIVED`), payment verified
  (`BOOKING_CONFIRMED` to customer + provider — only when verifying actually confirms the booking;
  with `autoConfirmOnVerify` off, the later `POST /bookings/:id/confirm` sends it instead), payment
  rejected (`PAYMENT_REJECTED` to customer, with the reason), cancel (`BOOKING_CANCELLED` to customer,
  + provider if the booking had reached `CONFIRMED`), reschedule (`BOOKING_RESCHEDULED` to customer +
  the *new* provider). A dedupe key keyed on template + booking + audience + an `occurrence` (a
  payment id, a new appointment id) means a second rejection or a second reschedule emails again
  instead of being silently deduped against the first.
- Delivery: a claim-one-row UPDATE (so two workers never double-send), render fresh from the booking
  at send time (never cached from when it was queued — a reschedule's email always describes the
  *current* time), send via `EmailProvider` (SMTP / Resend / console-in-development / disabled-by-
  default-in-production), log to `email_logs` + `notification_logs`, retry failures after 1, 2, 4,
  8 … minutes for 5 attempts. A ~1 s post-commit trigger plus a 30 s sweep cover delivery; both routes
  through the **already-existing** `jobs/scheduler.ts`/`jobs/queues.ts` generic BullMQ scaffolding
  (built ahead of this phase) — Phase 7 only added one periodic job and one registered task queue, not
  new infrastructure.
- **`/admin/notifications`** (status/template filters, search) and **`/admin/notifications/[id]`**:
  the rendered subject/body, every delivery attempt, and a **Retry** button for failed or skipped
  messages. **`/admin/notifications/templates`**: edit subject/body per event × audience (one row
  each, seeded — no create/delete, same as services), a live preview against sample data that reports
  unknown-variable errors instead of failing to save, "send test" to any address, and "install missing
  defaults" (never overwrites a template an admin has edited). The admin dashboard shows a "N emails
  failed to send" banner linking straight to the filtered log when there's something to look at.
- Templates render with Handlebars restricted to `{{var}}` and `{{#if}}`/`{{#unless}}` — no raw
  output, no other helpers, and only the variables that event actually provides (validated on save,
  re-checked on render). Recipients and variables always come from the booking's own submitted
  snapshot (name, email, phone) and its live appointment, never the `Customer` row directly — a later
  booking with the same email must never redirect an older one's mail (§3).

This project evolves an earlier general-purpose build. Its tested code for modules that later phases
adapt to ShifaWorks is **parked, not deleted**, under `legacy/` folders that are not compiled:

| Parked in | Comes back in |
| --------- | ------------- |
| `apps/web/legacy/`, `packages/shared/legacy/`, `apps/api/legacy/test/` | with their modules |

Removed for good (outside the ShifaWorks scope): customer portal and registration, form builder,
service/provider/category catalogue pages, online payment gateways, automated WhatsApp, reminders,
multi-location management (ShifaWorks runs one clinic; the seeded location stays in the schema).
Also removed as of Phase 5, fully superseded by the fresh booking engine and `/admin/bookings`,
`/provider/appointments`: the old `legacy/modules/{appointments,customers}` (API), the old
`legacy/app/admin/{appointments,calendar,customers}`, `legacy/app/provider/{appointments,calendar}`
and their components (web), and `legacy/{appointments,people}.ts` (shared) — none of it matched the
new schema closely enough to be worth adapting. There is still no dedicated customer directory: the
admin sidebar has no "Customers" item (only "Bookings", per spec), and a booking's own snapshot plus
customer record (shown on its detail page) has been enough so far.
Also removed as of Phase 6: `legacy/modules/{payments,invoices,finance}` (API) — the old payments
subsystem was built for an online-gateway checkout flow (webhooks, a `Refund` history table, a
derived paid-fraction status) that has no equivalent in ShifaWorks' manual-verification model, so
`payments.service.ts`/`payments.routes.ts`/`settlement.ts` were rewritten from scratch; `invoices` and
`finance` (ledger, categories, expenses) matched the current schema closely enough to adapt with only
the customer-scoping removed (customers have no accounts) and a couple of `PaymentStatus` string
fixes — see `docs/ARCHITECTURE.md` §3 and the Phase 6 section above for what changed and why.
Also removed as of Phase 7: `legacy/modules/notifications` (API) — the old module was built for
logged-in-user recipients (`recipientId` → `User`, `customer.user`/`provider.user` relations), a
generic multi-channel model (EMAIL/IN_APP/WHATSAPP/SMS, a `NotificationEvent` union, polymorphic
`entityType`/`entityId`), an in-app inbox, WhatsApp Business API automation and appointment/event
reminders — none of which exist in ShifaWorks (no customer accounts, no automated WhatsApp, no
reminders, a flat `bookingId`-keyed outbox with a fixed `EmailTemplateKey` set), so
`outbox.ts`/`context.ts`/`notifications.service.ts`/`templates.service.ts`/the routes were rewritten
from scratch. `render.ts`'s Handlebars sandbox and `providers/email.ts`'s SMTP/Resend/console
implementations carried over close to verbatim — the money-math and provider-adapter halves of a
module tend to survive a schema rewrite better than the query/relationship half does, the same lesson
Phase 6 drew from `money.ts`/`ledger.ts` versus `payments.service.ts`.
**Phase 8 (events) was dropped from scope entirely** — not deferred, removed: the event system was
never built beyond the schema (`Event`, `EventTicketType`, `EventBooking`, `EventBookingItem`,
`EventAttendee`, `EventCheckIn` tables, the `events`/`EVENT_STAFF` permission module/role,
`EVENT_BOOKING_RECEIVED`/`EVENT_BOOKING_CONFIRMED` template keys, the `EVT`/`TKT` document prefixes,
the "Events" nav item, and the demo event in the seed) and its still-uncompiled `legacy/modules/events`
+ `legacy/app/admin/events` + `legacy/components/events` code, all deleted. `Booking.type` stays as a
single-value `BookingType` enum (`APPOINTMENT` only) rather than being removed outright, since it's
load-bearing in working, tested query filters across bookings/invoices — removing it would have been
pure churn for no behavioural change.
Also removed as of Phase 9: `legacy/modules/{settings,audit,reports}` (API) — the old settings module
targeted a different `OrgSettings` shape (`holdMinutes`, `rescheduleCutoffHours`, `maxSlotSearchDays`,
an organisation logo) that doesn't match ShifaWorks' settings list (`packages/shared/src/settings.ts`,
written fresh in Phase 1), and the old reports module predates the current booking/appointment schema
entirely, so both were rewritten from scratch; the audit module's write side (`recordAudit`,
`auditContextFrom`) was already live from Phase 5 onward (built ahead of schedule, wired into every
module's mutations since), so Phase 9 only added its read side (list/export). **Phase 9 (reports, audit
logs, settings)** added: `GET/PATCH /admin/settings` (organisation identity + every `SETTINGS` key, one
call updates both); `GET /reports/:type[/export]` for `bookings`/`providers`/`services` — built on
`Appointment` rows (`rescheduledTo: null`, the same "live occurrence" filter `bookings.service.ts` uses)
filtered by `startsAt` in range, with revenue defined as the appointment's booked value for
`CONFIRMED`/`COMPLETED` rows (a simple operational figure, deliberately not the ledger's verified
income — that stays `/finance/summary`'s job); `GET /audit-logs[/export]`. No dedicated `/dashboard/*`
endpoints were built — `/admin` and `/provider`'s home pages already composed the existing
`/bookings`/`/notifications` list endpoints directly (built ahead of schedule in earlier phases), so
adding a parallel dashboard endpoint would have duplicated that query logic for no behavioural gain.
Phase 10 (testing, security, performance, deployment) is next in the original sequence, but **Phase 11
landed first**, by direct request: the booking form collapsed from 7 steps to 3 ("Your details" now
merges personal info, city/province, provider and package — both converted from card-buttons to
`<Select>` dropdowns — and the service's own "Service details" questions onto one screen; every field
is marked required or optional; the `address` field was dropped from the public form entirely, though
`Customer.address`/`Booking.customerAddress` stay in the schema since staff manual booking never used
it either); customers can attach a payment receipt before submitting, via a new anonymous upload
endpoint (`POST /public/bookings/receipt`, same private-bucket/magic-byte-sniff path
`uploadPrivateFile` already used, factored into `uploadPrivateFileAnonymous`) — doing so skips the
booking straight to `PAYMENT_SUBMITTED` instead of `PENDING_PAYMENT`; `ServicePackage` gained a simple
on/off percentage discount (`discountEnabled`/`discountPercent`), applied server-side in
`booking-engine.ts` into the `subtotal`/`discountAmount`/`totalAmount` columns that already existed on
`Booking`/`Appointment` but were always 0 before this; and a full digital-ticket check-in subsystem —
`Appointment` gained `checkInToken`/`checkedInAt`/`checkedInById`, the `BOOKING_CONFIRMED` email became
a branded ticket (colors `#934AA6`/`#85C141`/`#FFFFFF`/`#000000`, `bookingNumber` doubling as the ticket
number, a QR code linking to `/admin/check-in?token=…` hosted as a public PNG at a deterministic path),
and a new `/check-in` API + `/admin/check-in` page (camera scan via `html5-qrcode`, or manual
booking-number search) share one `POST /check-in/:appointmentId` action that's idempotent rather than
erroring on a duplicate scan. New dependencies: `qrcode` (API) and `html5-qrcode` (web).

The bare domain `/` redirects to shifaworks.com. There is no listing page, by design.

## Repository layout

```
apps/
  api/                      Express REST API (the only holder of secrets)
    prisma/schema.prisma    data model (ShifaWorks)
    prisma/migrations/      init + constraints (exclusion, CHECKs, RLS)
    prisma/seed.ts          idempotent seed
    scripts/verify-db.ts    checks the database guarantees
    src/  config/ lib/ middleware/ utils/ jobs/ modules/<feature>/ routes/
  web/                      Next.js app: service booking forms, admin, provider
packages/
  shared/                   enums, permissions + role matrix, settings catalogue,
                            service definitions (service-forms/), API envelope, validators
docs/ARCHITECTURE.md
docker-compose.yml          local Postgres 16 + Redis 7 (optional)
```

## Prerequisites

- Node.js ≥ 20.19 (developed on 24), npm ≥ 10
- A Supabase project (or Docker for a local Postgres)
- Redis only if you enable queues (`QUEUE_ENABLED=true`)

Prisma is pinned to exact `7.10.0` (CLI and client must match). `prisma@latest` points at an 8.0
release candidate with a different CLI: do not bump it with `@latest`.

## Setup

```bash
npm install

# 1. Configure env
cp apps/api/.env.example apps/api/.env      # DATABASE_URL, DIRECT_URL, SUPABASE_*, APP_SIGNING_SECRET, SEED_ADMIN_*
cp apps/web/.env.example apps/web/.env.local

# 2. Database
npm run db:generate          # generate Prisma client
npm run db:deploy            # apply migrations (init + constraints)
npm run db:seed              # organisation, roles, permissions, settings, the five services, super admin
                             # (+ demo providers and packages with SEED_DEMO_DATA=true)

# 3. Run (shared package in watch mode + API + web)
npm run dev                  # API http://localhost:4000/api/v1/health/ready, web http://localhost:3000
```

Check the database guarantees at any time: `cd apps/api && npx tsx --env-file=.env scripts/verify-db.ts`
(migrations applied, exclusion constraint present, CHECK constraints, RLS on every table).

After seeding, an admin fills in **Settings** (support phone / email / WhatsApp, bank and wallet
payment details, admin notification emails) and sets real **package prices**; the seed leaves
contact and payment fields empty and marks demo prices as demo. Services are seeded **closed**
unless `SEED_DEMO_DATA=true`.

### Supabase

- **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Accounts are
  invite-only (staff and providers); customers never log in.
- **Authentication → URL Configuration**: Site URL = the booking app URL; redirect URLs
  `…/auth/callback` and `…/auth/confirm`.
- **Authentication → Email Templates → Invite user / Reset password**: link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/set-password`
  (`type=recovery` for reset).
- `DATABASE_URL` → transaction pooler (6543) for the API; `DIRECT_URL` → session pooler (5432) for
  migrations and seed.
- Every table has **Row Level Security with no policies**: the anon key can read nothing; all access
  goes through the API. New tables must enable RLS in their migration.
- `SUPABASE_SERVICE_ROLE_KEY` exists **only** in `apps/api/.env`.
- Storage buckets: `public-media` (public: provider photos) and `private-files`
  (private: payment proofs, expense receipts).

### Local database instead of Supabase

```bash
docker compose up -d
# apps/api/.env
DATABASE_URL="postgresql://booking:booking@localhost:5432/booking"
DIRECT_URL="postgresql://booking:booking@localhost:5432/booking"
```

## Everyday commands

| Command | What it does |
| ------- | ------------ |
| `npm run typecheck` | strict type check of all workspaces |
| `npm test` | unit tests (Vitest) |
| `npm run build` | production build of shared, api, web |
| `npm run db:migrate` | create + apply a new migration in development |
| `npm run db:studio` | Prisma Studio |

### Adding a migration

1. Edit `apps/api/prisma/schema.prisma`.
2. `npm run db:migrate -- --name <change>` (development database).
3. If the change needs a constraint Prisma cannot express (exclusion, CHECK, RLS for a new table),
   run `npm run db:migrate -- --create-only --name <change>`, append the SQL, then apply.

## Testing

```bash
npm test                                   # unit tests (no database needed)
npm run test:integration -w @booking/api   # against a real database (uses apps/api/.env)
```

Current unit suites (102 tests):

- `modules/availability/slot-engine.test.ts` (27): the architecture examples (09:00–13:00 → hourly;
  with a 15-minute buffer → 09:00, 10:15, 11:30), breaks, custom intervals, seasonal schedules,
  existing bookings and buffers, blocked time, leave/custom hours/holidays, notice and advance
  limits, Karachi→UTC and DST, and the single-slot re-check used by the booking engine.

- `utils/contracts.test.ts`: every shared enum mirrors the Prisma schema; the slot-holding statuses
  match the exclusion constraint; document numbers; role matrix (no customer role, providers
  minimal); the five service URLs; the settings catalogue.
- `utils/db-errors.test.ts`: SQLSTATE detection through Prisma 7 adapter errors.
- `modules/auth/token-verifier.test.ts`: JWT signature, issuer, audience, expiry, anonymous sessions.
- `modules/auth/permission-rules.test.ts`: effective permissions (deny wins), escalation guard,
  home area (admin / provider / none).
- `middleware/auth.test.ts`: 401/403 behaviour, all-of and any-of permission guards.
- `modules/finance/money.test.ts` (3): invoice status derivation (issued/partial/paid/overdue, never
  touching draft or void), and invoice-line pricing (discount before tax, half-up rounding to paisa,
  a discount never exceeding the line, sums that land exactly on the cent).
- `modules/notifications/render.test.ts` (11): the Handlebars sandbox (known variables and `{{#if}}`/
  `{{#unless}}` accepted; an unknown variable, raw `{{{ }}}` output, and any other helper rejected; a
  variable valid on one template key but not another correctly scoped per key), HTML-escaping in the
  body vs. no escaping in the text-mode subject line, a missing variable rendering as `""` not a
  literal `{{var}}`, and `htmlToText`/`emailLayout`.
- `modules/notifications/dispatcher.test.ts` (2): the retry backoff schedule (1, 2, 4, 8, 16 … minutes,
  capped at 60).

Integration suite `test/integration/access.test.ts` (15 tests, real database): invite-only principal
(an unknown sign-in never creates an account), suspended and role-less accounts refused, staff
account creation, provider-only accounts refused, escalation, Super Admin assignment,
self-management, keep-one-role, suspend/reactivate, custom roles.

Integration suite `test/integration/availability.test.ts` (12 tests, real database): slots computed
from stored weekly hours with a break and the service's real buffers, package duration, available
dates, leave, custom hours, blocked time, a clinic holiday, online-only rules, backend gender
filtering, therapist/counselling type matching, provider-owns-availability, linking an existing
account as a provider login, and package create/reprice (audited)/delete.

Integration suite `test/integration/public-booking.test.ts` (17 tests, real database): service
bootstrap (open flag, packages, support, 404 for an unknown slug), backend gender filtering with no
contact fields on public provider cards, slot search, a full submission (customer/booking/appointment/
payment created together, matched-by-email on a repeat), an `Idempotency-Key` replay, gender-mismatch
and inactive-provider/-package rejections, an out-of-hours rejection, a honeypot rejection, and —
the one that matters most — two concurrent submissions for the same slot resolving to exactly one
winner via the database exclusion constraint. A separate "HTTP wiring" block sends the same requests
through the real Express app (`createApp()` + supertest) rather than calling the service layer
directly, specifically to catch route/middleware wiring mistakes a direct call wouldn't (this is
how a `GET /public/services/:slug` 500 — a controller reading `validated(req).params` on a route that
never ran `validate()` — was caught and fixed).

Integration suite `test/integration/bookings.test.ts` (16 tests, real database): manual booking
(default `PENDING_PAYMENT`, "paid at the desk" auto-confirms, needs `bookings.create`, still refuses
out-of-hours), listing/search/filters, provider-owns-only scoping on both list and detail (a provider
opening another provider's booking gets 404), internal notes, cancel (and refusing a second cancel),
complete/no-show (staff or the appointment's own provider, only once started — proven by moving a
confirmed appointment's time into the past directly, since the booking engine itself never accepts a
past start), reschedule (staff only; old appointment freed via the exclusion constraint; refuses
same-time-same-provider), and the same concurrent-request race as public-booking.test.ts, this time
for two bookings rescheduled onto the same free slot.

Integration suite `test/integration/payments.test.ts` (real database): mark-submitted, verify
(booking confirmed, `INCOME` row posted with the right amount and a `TXN-…` number), refusing to
verify the same payment twice, reject (booking back to `PENDING_PAYMENT`, exactly one fresh `PENDING`
payment opened with a different number), refund (partial leaves `VERIFIED` with `refundedAmount` set,
full moves to `REFUNDED`, over-refunding rejected, refunding a never-verified payment rejected), and
the `payments.verify`/`payments.refund` permission gates (verify alone is not enough to refund).

Integration suite `test/integration/invoices.test.ts` (real database): raising an invoice from a
booking (one line from the appointment snapshot, idempotent re-raise, an already-verified payment
counted towards it immediately), manual invoice line pricing (discount before tax, half-up to 2dp),
rejecting an unknown customer, issuing a draft, and voiding (refused while an unrefunded payment is
attached, succeeds once refunded).

Integration suite `test/integration/finance.test.ts` (real database): a manual `ADJUSTMENT` entry
with a `TXN-…` number, rejecting an income category on an `EXPENSE` entry, voiding a manual entry,
the `finance.create` gate, and expenses (draft → approved → paid posting the `EXPENSE` ledger row,
blocking self-approval unless Super Admin, refusing to delete an approved expense, deleting a draft).

Integration suite `test/integration/notifications.test.ts` (17 tests, real database, a fake
`EmailProvider` swapped in via `setEmailProviderForTest` so nothing touches a real inbox): booking
submission queues `BOOKING_RECEIVED` to customer + admin only (not provider), "paid at the desk"
sends admin `BOOKING_RECEIVED` and customer + provider `BOOKING_CONFIRMED` instead, delivery renders
and sends and logs to both `email_logs` and `notification_logs` and marks the row `SENT`, verifying a
payment (auto-confirm on) queues `BOOKING_CONFIRMED`, rejecting queues `PAYMENT_REJECTED` with the
reason baked into the rendered body and — the one that matters most for a repeatable event — rejecting
the *same* booking's payment twice queues two distinct notifications rather than deduping the second
one away, cancelling emails the provider only if the booking had reached `CONFIRMED`, rescheduling
emails the *new* provider (not the one the booking moved away from), a transient `DeliveryError`
leaves the row `FAILED` for retry, `retryNotification` re-queues with fresh attempts and refuses a
row that isn't failed or skipped, "send test" delivers synchronously with sample values and no
booking, list/get scoping, and template update rejecting an unknown variable plus preview reporting
errors instead of throwing. `test/integration/setup.ts` calls `setAutoDispatch(false)` for the whole
suite — integration tests run with `NODE_ENV=development` (the real dev config), not `test`, so the
dispatcher's own `!isTest` guard doesn't apply, and without this every booking any integration test
creates would schedule a real ~1 s-later delivery timer that could fire after that test file's own
`afterAll()` had already disconnected Prisma.

The other integration suites return with their modules (parked under `apps/api/legacy/test/`).
Their cleanup must only delete rows the test created: guard every fixture id with `ids()` from
`test/integration/cleanup.ts`, because Prisma treats `{ id: undefined }` as "match every row".
