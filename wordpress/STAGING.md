# Staging: WordPress availability calendar

Nothing here has been deployed. This file says what was verified locally, what only you can verify on staging,
and exactly how to do it. Production must not be touched until the staging checklist is complete and approved.

## 0. What the repo shows about environments

- There is **no staging configuration in the repository**: no staging env file, branch, or deployment script.
- API and web are deployed separately (`apps/api/vercel.json`, `apps/web/vercel.json`).
- `apps/api/.env` points at a hosted Supabase database; nothing in the repo says whether that database is a
  development, staging or production one. **Do not use it for the browser end-to-end test until you confirm
  it is a throwaway/staging database** (see section 3).

You need, all separate from production: a staging API deployment, a staging database (with migrations applied
and the organization seeded), a staging web deployment, and a staging WordPress site with Elementor Pro.

## 1. Staging configuration

API (staging only):

| Variable | Value |
| --- | --- |
| `PUBLIC_CORS_ORIGINS` | the staging WordPress origin only, e.g. `https://staging.shifaworks.com` (no slash, no path, https) |
| `CORS_ORIGINS` | the staging web app origin only (unchanged meaning) |
| `TRUST_PROXY_HOPS` | see below |
| `DEFAULT_ORGANIZATION_SLUG`, database, Supabase, Cloudinary, email | staging values. Keep `EMAIL_PROVIDER` on `console` or `disabled` so test bookings email nobody. |

Production, when the time comes (do not apply yet): `PUBLIC_CORS_ORIGINS=https://shifaworks.com,https://www.shifaworks.com`
and never the staging origin. The API refuses to start on a wildcard, a path, a trailing slash, or (in production) an `http://` origin.

### TRUST_PROXY_HOPS

It is the number of reverse proxies between the visitor and Express, so the rate limiter sees the visitor's IP.
It currently defaults to `0`. With `0` behind a proxy, every visitor appears to be the proxy's IP and they **share one**
rate-limit bucket (300 requests/minute by default), so one busy period could lock everyone out of the calendar.

- If the API runs on Vercel the usual value is `1` (one proxy hop). This is a recommendation, not something I could
  confirm from here.
- Verify on staging without changing code: set `RATE_LIMIT_MAX=5` temporarily, send 6 requests from one device
  (`curl https://<staging-api>/api/v1/public/team/x` six times), then request once from a different network (phone on mobile
  data). The other network must still get an answer, not 429. If it is also 429, the hop count is too low. Restore
  `RATE_LIMIT_MAX` afterwards.
- Do not change production until staging shows the right value.

## 2. Install the plugin on staging WordPress

Plugin ZIP: `wordpress/dist/shifa-availability-1.0.0.zip` (git-ignored build output). SHA-256:
`ab2a5cd3dcfa3f428e89b7814d5f8c633d4c2a0eb4f9c12f7a4e52728615d761`. Rebuild it from `wordpress/shifa-availability/` if you change a file.

1. Plugins > Add New > Upload Plugin > the ZIP > Activate. Expect no notices or warnings.
2. Settings > ShifaWorks Availability: Booking API address `https://<staging-api>/api/v1`, Booking website `https://<staging-web>`.
   Better: pin them in `wp-config.php` (`SHIFA_AV_API_BASE`, `SHIFA_AV_BOOKING_BASE`, `SHIFA_AV_FALLBACK_URL`) so staging can't point at production.
3. Elementor Pro > Theme Builder > Single Page > new template with a **Shortcode** widget holding `[shifa_availability]`;
   set its display condition to the team pages.
4. Create at least two team pages from that template and fill the "Booking system provider" box on each.

## 3. Isolated provider for the end-to-end test (staging database only)

In the **staging** dashboard (or with the staging database), create:

- Two providers, e.g. slugs `stg-test-one` and `stg-test-two`, both active, linked to a service such as Hijama Therapy,
  with different weekly hours (so you can tell their calendars apart), at least one active package each,
  and one provider with two packages of different length.
- Give `stg-test-one` a day off or a blocked time, and leave `stg-test-two` fully open on the same day.

Delete both providers (and any test bookings) when finished. Leftover test providers stay bookable on the public form.

## 4. Verified locally, and how

| Item | Result | How |
| --- | --- | --- |
| API unit tests | passed | `npm run test -w @booking/api` |
| Web unit tests (URL prefill, invalid parameters, provider match after gender, stale slot, timezone) | passed | `npm run test -w @booking/web` |
| Integration tests (team endpoint fields, 404s, stale slot, concurrent double booking, CORS, rate limit) | passed | `npm run test:integration -w @booking/api -- test/integration/public-booking.test.ts test/integration/public-cors.test.ts`, run against the development database |
| Typecheck, all workspaces | passed | `npm run typecheck` |
| `next build` (web) | passed; booking pages are prerendered, no Suspense/`useSearchParams` error | `npm run build -w @booking/web` |
| Plugin PHP syntax | passed on PHP 8.1.34 (official build, checksum verified) | `php -l` on every file, including the unzipped ZIP |
| Plugin PHP logic against WordPress stand-ins | passed | `php wordpress/tests/php-smoke.php` |
| Calendar JavaScript in headless Chrome against a stub API | passed | `node wordpress/tests/widget-smoke.mjs` |

## 5. Not verified (needs staging)

Mark each when done. None of these can be claimed as tested yet.

**Plugin and WordPress**
- [ ] Plugin activates on real WordPress without PHP warnings (only PHP 8.1 was run; the plugin declares 7.4+ and that was not executed)
- [ ] Settings page saves the staging API and booking URLs; an `http://` public URL is refused
- [ ] The shortcode renders inside Elementor Pro's Shortcode widget, in the editor preview and on the live page
- [ ] One Single Page template shows the correct, different calendar on two or more therapist pages
- [ ] Mapping box: valid slug shows "Linked to <name>"; invalid slug shows the red message; duplicate slug warns
- [ ] Missing, invalid, inactive mapping each show the Book Appointment button; no technical text visible to a logged-out visitor
- [ ] Logged-in administrator sees the diagnostic note; a logged-out browser does not
- [ ] JavaScript disabled in the browser: the Book Appointment button shows
- [ ] Page-caching/minify plugin enabled: calendar still loads and updates; no stale slots
- [ ] Mobile (360 px wide) and desktop layout; month navigation forward and back; no horizontal scrolling
- [ ] Unticking "Show the availability calendar" turns the calendar off everywhere

**Booking flow (staging provider from section 3)**
- [ ] The first therapist's profile shows only the first therapist's dates and times; the second shows the second's
- [ ] Nothing is shown until service and package are picked; changing the package changes the available times
- [ ] Choosing a time opens the booking form with the correct service, package, date and time already selected
- [ ] Provider is selected automatically after you pick a gender; with the other gender you see the "isn't available" message
- [ ] Completing the form with test data creates the booking; the profile page no longer offers that time after a refresh (or within about a minute without refreshing)
- [ ] Open the profile in two browsers, choose the same time in both, submit both: one succeeds, the other shows a clear "no longer available" message
- [ ] Edit the therapist's hours / add a block in the therapist dashboard: the profile reflects it within a minute
- [ ] Booking a slot in the dashboard as staff removes it from the profile
- [ ] Booking form opened directly (no parameters) behaves exactly as before; same with the plugin disabled

**API and security**
- [ ] `curl -i https://<staging-api>/api/v1/public/team/stg-test-one` returns only the documented fields
- [ ] From the staging WordPress origin: browser calls to `/public/team` and `/public/availability/*` succeed
- [ ] From any other origin: no `Access-Control-Allow-Origin` header on those routes
- [ ] A cross-origin `POST /public/bookings` from the WordPress origin is blocked by the browser (preflight has no allow-origin)
- [ ] Authenticated dashboard still works from the staging web app
- [ ] Break the API address in plugin settings (or stop the staging API): profile pages show the Book Appointment button
- [ ] TRUST_PROXY_HOPS check from section 1

## 6. Disable and roll back (staging or later production)

Fastest first; none of them touches the booking system's data.

1. Plugin settings: untick "Show the availability calendar". Profile pages show only the button.
2. Deactivate the plugin (the shortcode then prints as plain text, so also remove it from the Elementor template if you deactivate).
3. Clear `PUBLIC_CORS_ORIGINS` on the API and redeploy: browsers can no longer read availability from WordPress.
4. Revert the code changes (API/shared/web) if ever needed. They are additive: one new read-only endpoint, a `slug` field on provider cards,
   and optional URL parameters on the booking form. No database migration was added, so there is nothing to undo in the database.
5. Delete the staging test providers and bookings (section 3).
