import type { SessionOptions } from "iron-session";

/**
 * Shape of the data stored in the encrypted iron-session cookie.
 * Edge-safe: this module must NOT import Prisma (middleware imports it).
 */
export interface SessionData {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "VIEWER";
}

export const sessionOptions: SessionOptions = {
  cookieName: "procurement_session",
  password: process.env.SESSION_SECRET as string,
  cookieOptions: {
    httpOnly: true,
    // secure must be false in local dev (http://localhost) so the cookie is set
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};
