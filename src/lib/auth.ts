import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { nanoid } from "nanoid";
import * as argon2 from "argon2";
import { createHash } from "crypto";

const SESSION_COOKIE_NAME = "kolo_session";
const SESSION_EXPIRY_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await argon2.verify(hash, password);
}

export async function createSession(userId: string, userAgent?: string, ipAddress?: string) {
  const sessionId = nanoid(32);
  const sessionHash = hashToken(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      id: sessionHash,
      userId,
      expiresAt,
      userAgent,
      ipAddress,
    },
  });

  (await cookies()).set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return sessionId;
}

export async function validateSession() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const sessionHash = hashToken(sessionId);

  const session = await prisma.session.findUnique({
    where: { id: sessionHash },
    include: { user: true },
  });

  if (!session) {
    (await cookies()).delete(SESSION_COOKIE_NAME);
    return null;
  }

  if (Date.now() >= session.expiresAt.getTime()) {
    await prisma.session.delete({ where: { id: sessionHash } });
    (await cookies()).delete(SESSION_COOKIE_NAME);
    return null;
  }

  // Optional: Refresh session expiry if it's close to expiring
  const halfExpiry = (SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000) / 2;
  if (Date.now() >= session.expiresAt.getTime() - halfExpiry) {
    const newExpiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await prisma.session.update({
      where: { id: sessionHash },
      data: { expiresAt: newExpiresAt },
    });
    (await cookies()).set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: newExpiresAt,
      path: "/",
    });
  }

  return session.user;
}

export async function invalidateSession() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) {
    const sessionHash = hashToken(sessionId);
    await prisma.session.deleteMany({ where: { id: sessionHash } });
  }
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

export async function logoutEverywhere(userId: string) {
  await prisma.session.deleteMany({
    where: { userId },
  });
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
