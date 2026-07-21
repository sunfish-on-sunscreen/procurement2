import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/prisma";
import { sessionOptions, type SessionData } from "@/lib/session";

export type { SessionData };

/**
 * Reads the iron-session cookie AND confirms the user it names still exists.
 *
 * ⚠️ The existence check is load-bearing, not defensive. The cookie outlives the
 * database: `prisma db seed` recreates users with fresh cuids, so a browser signed
 * in before a re-seed keeps presenting a `userId` that no longer resolves. Without
 * this check such a session passes authorization (role is read from the cookie) and
 * then fails deep inside a write, on any FK referencing `User` — e.g.
 * `SupplierChangeLog.changedBy` — which surfaces as an unattributable 500 rather
 * than "sign in again".
 *
 * `stale` distinguishes "never signed in" from "signed in as someone who is gone",
 * so a route can say which. Costs one PK lookup per call.
 *
 * ⚠️ Deliberately does NOT clear the cookie: this runs in server components too,
 * where mutating cookies throws. Callers surface the state; sign-in overwrites it.
 */
export async function readSession(): Promise<{ session: SessionData | null; stale: boolean }> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.userId) {
    return { session: null, stale: false };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true },
  });
  if (!user) {
    return { session: null, stale: true };
  }

  return {
    session: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
    },
    stale: false,
  };
}

/**
 * Reads the iron-session cookie and returns the session payload, or null if
 * the visitor is not signed in (or is signed in as a user that no longer exists —
 * see `readSession`).
 */
export async function getSession(): Promise<SessionData | null> {
  return (await readSession()).session;
}

/**
 * Creates a DB Session row (7-day expiry) and writes the encrypted
 * iron-session cookie. Must be called from a Route Handler / Server Action.
 */
export async function createSession(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Cannot create session: user not found");
  }

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
  await prisma.session.create({
    data: { userId: user.id, expiresAt },
  });

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  session.role = user.role;
  await session.save();
}

/**
 * Deletes the visitor's DB Session rows and clears the iron-session cookie.
 * Must be called from a Route Handler / Server Action.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (session.userId) {
    await prisma.session.deleteMany({ where: { userId: session.userId } });
  }

  session.destroy();
}

/**
 * Server-component guard: redirects to /login when there is no session.
 */
export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Server-component guard: requires an ADMIN session, otherwise redirects to /.
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();
  if (session.role !== "ADMIN") {
    redirect("/");
  }
  return session;
}
