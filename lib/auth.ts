import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/prisma";
import { sessionOptions, type SessionData } from "@/lib/session";

export type { SessionData };

/**
 * Reads the iron-session cookie and returns the session payload, or null if
 * the visitor is not signed in.
 */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.userId) {
    return null;
  }

  return {
    userId: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
  };
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
