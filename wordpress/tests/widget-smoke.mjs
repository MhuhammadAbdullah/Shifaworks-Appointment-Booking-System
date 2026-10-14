/**
 * Browser smoke test for assets/js/shifa-availability.js.
 *
 * Starts a stub of the public booking API plus a page that carries the same markup the shortcode renders,
 * drives it in headless Chrome and checks the DOM it ends up with. Needs Chrome/Edge (CHROME_PATH to override).
 *
 *   node wordpress/tests/widget-smoke.mjs
 *
 * It does not need WordPress, PHP or the real API. It does not replace the staging checklist.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const widgetJs = fs.readFileSync(path.join(here, "../shifa-availability/assets/js/shifa-availability.js"), "utf8");
const CHROME =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("Chrome/Edge not found; set CHROME_PATH");

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const PKG_FULL = "22222222-2222-4222-8222-222222222222";
const PKG_SHORT = "33333333-3333-4333-8333-333333333333";
const profile = (services) => ({
  id: PROVIDER_ID, slug: "test-person", displayName: "Test <b>Person</b>", designation: null, photoUrl: null,
  acceptsMale: true, acceptsFemale: false, timezone: "Asia/Karachi", services,
});
const hijama = { slug: "hijama-therapy", name: "Hijama", packages: [
  { id: PKG_FULL, name: "Full", durationMinutes: 60 },
  { id: PKG_SHORT, name: "Short", durationMinutes: 30 },
] };

const calls = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const json = (status, body) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  const ok = (data) => json(200, { success: true, data });
  calls.push(u.pathname + u.search);

  if (u.pathname === "/plugin.js") { res.setHeader("content-type", "text/javascript"); return res.end(widgetJs); }
  if (u.pathname === "/page") {
    const slug = u.searchParams.get("slug") || "test-person";
    const api = u.searchParams.get("api") || `http://localhost:${port}/api`;
    const drive = u.searchParams.get("drive") === "1";
    res.setHeader("content-type", "text/html");
    return res.end(`<!doctype html><meta charset=utf-8><body>
<div class="shifa-av" data-shifa-av data-provider="${slug}" data-api="${api}" data-booking="http://localhost:${port}/booking" data-fallback-label="Book Appointment"><div class="shifa-av__fallback"><a class="shifa-av__button" href="/fallback">Book Appointment</a></div></div>
${u.searchParams.get("nojs") === "1" ? "" : '<script src="/plugin.js"></script>'}
${drive ? `<script>
// Poll rather than use fixed delays: the page waits on real network replies while Chrome's clock is virtual.
const tick = setInterval(() => {
  const slot = document.querySelector('.shifa-av__slot');
  const day = document.querySelector('.shifa-av__day.is-open');
  const sel = document.querySelector('select');
  if (slot) { clearInterval(tick); slot.click(); }
  else if (day && !day.dataset.clicked) { day.dataset.clicked = '1'; day.click(); }
  else if (sel && sel.value === '') { sel.value = '0'; sel.dispatchEvent(new Event('change')); }
}, 150);
</script>` : ""}</body>`);
  }
  if (u.pathname === "/booking/hijama-therapy") { res.setHeader("content-type", "text/html"); return res.end(`<body><pre id="landed">${req.url}</pre></body>`); }

  if (u.pathname === "/api/public/team/test-person") return ok(profile([hijama]));
  if (u.pathname === "/api/public/team/no-services") return ok(profile([]));
  if (u.pathname === "/api/public/team/limited") return json(429, { success: false, code: "RATE_LIMITED" });
  if (u.pathname.startsWith("/api/public/team/")) return json(404, { success: false, code: "NOT_FOUND", message: "Provider not found" });
  if (u.pathname === "/api/public/availability/dates") return ok({ timezone: "Asia/Karachi", durationMinutes: 60, dates: [iso(3), iso(5)], closedDates: [] });
  if (u.pathname === "/api/public/availability/slots") {
    const date = u.searchParams.get("date");
    return ok({ timezone: "Asia/Karachi", durationMinutes: 60, date, slots: [
      { startsAt: `${date}T04:00:00.000Z`, endsAt: `${date}T05:00:00.000Z`, date, time: "09:00" },
      { startsAt: `${date}T09:15:00.000Z`, endsAt: `${date}T10:15:00.000Z`, date, time: "14:15" },
    ] });
  }
  json(404, { success: false, code: "NOT_FOUND" });
});

let port = 0;
await new Promise((r) => server.listen(0, r));
port = server.address().port;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "shifa-av-"));

// Chrome is started with its output in a file (not a pipe): its helper processes can keep a pipe open
// after the main process has finished, which would hang the test.
let runs = 0;
async function dom(query, extraFlags = []) {
  // A cold Chrome start occasionally produces no output at all; one retry separates that from a real failure.
  const first = await domOnce(query, extraFlags);
  return first.trim() ? first : domOnce(query, extraFlags);
}

function domOnce(query, extraFlags) {
  const outFile = path.join(profileDir, `out-${runs}.html`);
  const fd = fs.openSync(outFile, "w");
  const args = ["--headless=new", "--disable-gpu", `--user-data-dir=${path.join(profileDir, "profile-" + runs)}`, "--virtual-time-budget=6000", ...extraFlags, "--dump-dom", `http://localhost:${port}/page?${query}`];
  runs++;
  return new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: ["ignore", fd, "ignore"] });
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", () => {
      clearTimeout(timer);
      fs.closeSync(fd);
      resolve(fs.readFileSync(outFile, "utf8"));
    });
  });
}

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + detail}`);
  if (!cond) failures++;
}
const fallbackOnly = (html) => html.includes('class="shifa-av__fallback"') && html.includes("Book Appointment") && !html.includes("shifa-av__body");

// 1. Mapped provider: package chosen, then a date, then a slot -> the browser requests the booking form with the
//    prefill. Judged from the request the stub receives, not from the dumped page: Chrome's dump races the navigation.
{
  await dom("drive=1");
  const landed = calls.find((c) => c.startsWith("/booking/hijama-therapy")) ?? "";
  check("full flow sends the visitor to the booking form with provider, package and start", landed.includes("provider=test-person") && landed.includes(`package=${PKG_FULL}`) && /start=\d{4}-\d{2}-\d{2}T04%3A00%3A00\.000Z/.test(landed), landed || "(no navigation)");
}
// 2. Before a package is chosen nothing is offered, and API text is shown as text.
{
  const html = await dom("");
  check("no dates are shown before a package is chosen", html.includes("Choose a session to see available dates.") && !html.includes("shifa-av__day"));
  check("API text is escaped, never parsed as HTML", html.includes("Test &lt;b&gt;Person&lt;/b&gt;") && !html.includes("<b>Person"));
  check("gender policy note is shown", html.includes("are for male clients."));
}
// 3. Fallbacks.
check("unknown provider -> Book Appointment button only", fallbackOnly(await dom("slug=nobody")));
check("provider without bookable services -> button only", fallbackOnly(await dom("slug=no-services")));
check("rate limited (429) -> button only", fallbackOnly(await dom("slug=limited")));
check("API unreachable -> button only", fallbackOnly(await dom(`api=${encodeURIComponent("http://localhost:1/api")}`)));
// Headless Chrome returns nothing for --dump-dom with scripting switched off, so "JS off" is checked by
// loading the same markup without the script: what the server rendered must already be the button.
check("no script runs (JavaScript off) -> button only", fallbackOnly(await dom("nojs=1")));

// 4. Requests: only the three public GET endpoints, no credentials sent.
check("calls only /public/team and /public/availability", calls.filter((c) => c.startsWith("/api/")).every((c) => /^\/api\/public\/(team\/|availability\/(dates|slots))/.test(c)));

server.close();
fs.rmSync(profileDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
