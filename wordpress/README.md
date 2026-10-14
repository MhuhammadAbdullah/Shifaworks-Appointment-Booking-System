# ShifaWorks Availability Calendar (WordPress plugin)

Shows each team member's live availability on their WordPress profile page. The booking system stays the
single source of truth: WordPress stores no availability, only which provider a page belongs to.

```
shifa-availability/
  shifa-availability.php          bootstrap
  includes/class-settings.php     Settings > ShifaWorks Availability (public URLs only, no secrets)
  includes/class-api.php          admin-only provider lookup (never runs for visitors)
  includes/class-mapping.php      "Booking system provider" box, duplicate warning, pages-list column
  includes/class-shortcode.php    [shifa_availability]
  assets/js/shifa-availability.js vanilla JS calendar (talks to the public API from the browser)
  assets/css/shifa-availability.css
  uninstall.php                   removes the plugin's settings only
```

## Install

1. Zip the `shifa-availability` folder, then Plugins > Add New > Upload, and activate.
2. Settings > ShifaWorks Availability: set the **Booking API address** (e.g. `https://api.shifaworks.com/api/v1`)
   and **Booking website** (e.g. `https://booking.shifaworks.com`). Or pin them in `wp-config.php` so staging and
   production can't be mixed up:
   ```php
   define( 'SHIFA_AV_API_BASE',     'https://api.shifaworks.com/api/v1' );
   define( 'SHIFA_AV_BOOKING_BASE', 'https://booking.shifaworks.com' );
   define( 'SHIFA_AV_FALLBACK_URL', 'https://booking.shifaworks.com' );
   ```
3. The API server must list this website in `PUBLIC_CORS_ORIGINS` (see below), or browsers will block the calendar
   and visitors will see only the fallback button.

## One reusable profile template (Elementor Pro)

1. Theme Builder > Single Page > Add New. Design the shared profile layout once.
2. Where the calendar should appear, add a **Shortcode** widget containing `[shifa_availability]`.
3. Display conditions: apply the template to the team pages (for example pages under a parent page "Team", or an
   explicit list). The exact condition choices depend on your Elementor Pro version, so confirm on staging.

The shortcode with no attributes reads the current page's linked provider, so one template serves every team
member. `[shifa_availability provider="slug"]` names a provider explicitly.

## Adding a new team member (no code)

1. Booking dashboard: create the provider, assign services and packages, set the weekly schedule. Open the
   provider (Admin > Providers) and use the **Website calendar** card at the top of the Profile tab: it shows the
   provider address with a Copy button, a readiness check, and test links.
2. WordPress: create a Page using the profile template.
3. In the **Booking system provider** box on the page editor, paste the address and update the page. The box shows
   "Linked to ..." in green, or a red message if the address is wrong or the provider is inactive.
4. Publish. The calendar loads that provider's availability.

Keep the address unchanged once a page is live: changing a provider's address in the dashboard breaks the link
(visitors then see the booking button until the page is updated).

## What visitors see

| Situation | Visitor sees | Administrator also sees |
| --- | --- | --- |
| Linked, bookable | Calendar | nothing extra |
| Page not linked | "Book Appointment" button | note to add the address |
| Address unknown or provider inactive | "Book Appointment" button | note naming the bad address |
| Provider has no open service or package | "Book Appointment" button | note |
| API down, blocked by CORS, rate limited, JS off | "Book Appointment" button | note when the server can tell |
| Plugin switched off in settings | "Book Appointment" button | nothing |

Visitors never see technical detail. Diagnostics appear only to logged-in users who can edit pages.

## Booking-system configuration (new)

| Variable | Where | Purpose |
| --- | --- | --- |
| `PUBLIC_CORS_ORIGINS` | API server | Comma-separated bare origins allowed to **read** `/api/v1/public/team/*` and `/api/v1/public/availability/*` from a browser. GET only, no cookies. Separate from `CORS_ORIGINS`, which is unchanged. Empty (default) = off. |

- Production: `PUBLIC_CORS_ORIGINS=https://shifaworks.com,https://www.shifaworks.com` (https is enforced in production).
- Staging: only the staging WordPress origin, e.g. `https://staging.shifaworks.com`. Never list staging in production or the reverse.
- Origins have no wildcard, path or trailing slash; the API refuses to start if one is malformed.
- No new variable is needed for the web app. The WordPress plugin holds no secrets.
- Behind a reverse proxy, check `TRUST_PROXY_HOPS`. If it stays 0, every visitor looks like one IP and shares one
  rate limit.

## Deploy order

1. API + shared package (additive: a new read-only endpoint, `slug` added to provider cards; no migration).
2. Set `PUBLIC_CORS_ORIGINS` and restart the API.
3. Web app (the booking form accepts `?provider=&package=&start=`; it behaves as before without them).
4. Plugin on staging WordPress, test, then production.

## Rollback

- Fastest: untick "Show the availability calendar" in the plugin settings. Profile pages show only the button.
- Or deactivate the plugin / remove the shortcode from the Elementor template.
- The booking system is not touched by any of this. Clearing `PUBLIC_CORS_ORIGINS` closes browser access at the API.
- Deleting the plugin removes its settings only; the per-page links are kept.

## Checks

- `php wordpress/tests/php-smoke.php` runs the plugin's PHP against stand-ins for WordPress functions.
- `node wordpress/tests/widget-smoke.mjs` drives the calendar in headless Chrome against a stub API.
- Neither is WordPress or Elementor. The staging checklist, installation steps and what is still unverified are in
  [STAGING.md](STAGING.md). Build the ZIP from this folder (`shifa-availability/` at the top level, forward-slash paths).
