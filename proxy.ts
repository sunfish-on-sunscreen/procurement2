import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(
    request,
    response,
    sessionOptions,
  );

  if (!session.userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Protect everything EXCEPT: /login, /api/auth/*, Next internals, and static
  // assets (any path containing a dot, e.g. *.svg, *.ico).
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
