import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Staff and provider areas. Booking forms (/hijama-therapy, …) and /events/* are public.
const PROTECTED_PREFIXES = ["/admin", "/provider", "/account"];
const GUEST_ONLY = ["/login", "/forgot-password"];
// Fully public pages: skip the Supabase round trip below entirely (faster, and
// an anonymous visitor filling in a booking form never needs a session check).
const PUBLIC_PREFIXES = ["/hijama-therapy", "/speech-therapy", "/islamic-life-coaching", "/faith-based-counseling", "/clinical-counseling", "/events"];

/**
 * Runs before every matched request:
 *  1. refreshes the Supabase session cookie (keeps SSR + browser in sync);
 *  2. redirects signed-out visitors away from private areas.
 * This is a UX gate only — the API enforces authentication and permissions
 * on every request regardless of what the browser shows.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getClaims() verifies the JWT signature (via JWKS) instead of trusting the cookie.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { search } = request.nextUrl;

  if (!signedIn && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && GUEST_ONLY.includes(pathname)) {
    // "/" is the WordPress site; the admin shell forwards providers to /provider.
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
