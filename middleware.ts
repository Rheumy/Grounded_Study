import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

const authMiddleware = withAuth({
  pages: {
    signIn: "/signin"
  }
});

const publicApiPrefixes = [
  "/api/auth",
  "/api/billing/webhook",
  "/api/admin/process-jobs",
  "/api/cron/process-ingestion"
];

function requiresAuth(pathname: string) {
  if (pathname.startsWith("/dashboard")) return true;
  if (!pathname.startsWith("/api/")) return false;
  return !publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (process.env.APP_PAUSED === "true") {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "The Sulcai beta is paused. New uploads and question generation are unavailable." },
        { status: 503, headers: { "Retry-After": "86400" } }
      );
    }

    const pausedUrl = request.nextUrl.clone();
    pausedUrl.pathname = "/paused";
    pausedUrl.search = "";
    return NextResponse.rewrite(pausedUrl, { status: 503 });
  }

  if (requiresAuth(request.nextUrl.pathname)) {
    return authMiddleware(request as NextRequestWithAuth, event);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|paused).*)"]
};
