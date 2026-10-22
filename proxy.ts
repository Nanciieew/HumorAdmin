import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { productionPageRedirect } from "@/lib/auth/production-url";

export async function proxy(request: NextRequest) {
  const canonical = productionPageRedirect(request);
  if (canonical) {
    const response = NextResponse.redirect(canonical, 307);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  // Overwrite any client-supplied value. Layout and page guards must agree on
  // the login destination even when Next renders their segments concurrently.
  request.headers.set("x-checked-admin-return", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const auth = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, cacheHeaders) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  await auth.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/", "/login", "/profile/:path*", "/auth/:path*", "/admin/:path*", "/api/admin/:path*", "/disguise/:path*", "/api/factory/:path*", "/api/images"] };
