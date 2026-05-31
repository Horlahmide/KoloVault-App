import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "kolo_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  // 1. CSRF Protection for mutating requests
  const mutatingMethods = ["POST", "PUT", "DELETE", "PATCH"];
  if (mutatingMethods.includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    // Simple CSRF check: Origin must match Host
    // In production, you might want to be more specific with protocol etc.
    if (origin && host) {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    } else if (!origin && request.headers.get("referer")) {
      // Fallback to referer if origin is missing (rare for modern browsers on POST)
      const referer = request.headers.get("referer");
      if (referer) {
        const refererHost = new URL(referer).host;
        if (refererHost !== host) {
          return new NextResponse("Forbidden", { status: 403 });
        }
      }
    }
    // If both origin and referer are missing, we might want to block or allow depending on policy.
    // For this app, we'll require at least one for mutating requests from browsers.
    if (!origin && !request.headers.get("referer")) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // 2. Route Protection
  const isAuthRoute = pathname.startsWith("/auth");
  const isDashboardRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/settings") || pathname === "/";

  if (isDashboardRoute && !sessionId) {
    if (pathname === "/") return NextResponse.next(); // Allow landing page if I add one, but dashboard is priority
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (isAuthRoute && sessionId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
