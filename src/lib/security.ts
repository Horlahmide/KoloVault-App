import { prisma } from "./prisma";

const IP_RATE_LIMIT_MAX = 5;
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const ACCOUNT_LOCKOUT_MAX = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Consumes one rate limit attempt for an IP.
 * Returns true if the attempt is allowed, false if blocked.
 * Uses a transaction to prevent race conditions.
 */
export async function consumeIpRateLimit(ip: string): Promise<boolean> {
  const key = `login:ip:${ip}`;
  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const record = await tx.rateLimit.findUnique({
      where: { key },
    });

    if (!record) {
      await tx.rateLimit.create({
        data: { key, count: 1, lastAttempt: now },
      });
      return true;
    }

    const lastAttemptTime = record.lastAttempt.getTime();
    let newCount: number;

    if (now.getTime() - lastAttemptTime > IP_RATE_LIMIT_WINDOW_MS) {
      // Window expired, reset to 1
      newCount = 1;
    } else {
      // Within window, increment
      newCount = record.count + 1;
    }

    await tx.rateLimit.update({
      where: { key },
      data: { count: newCount, lastAttempt: now },
    });

    return newCount <= IP_RATE_LIMIT_MAX;
  });
}

export async function handleFailedLogin(userId: string) {
  return await prisma.$transaction(async (tx) => {
    // 1. Atomically increment failed attempts
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        failedAttempts: { increment: 1 },
      },
    });

    // 2. If the threshold is reached or exceeded, apply/extend the lockout
    if (user.failedAttempts >= ACCOUNT_LOCKOUT_MAX) {
      await tx.user.update({
        where: { id: userId },
        data: {
          lockoutUntil: new Date(Date.now() + ACCOUNT_LOCKOUT_WINDOW_MS),
        },
      });
    }
  });
}

export async function resetFailedLogin(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedAttempts: 0,
      lockoutUntil: null,
    },
  });
}

export function validatePassword(password: string): boolean {
  if (password.length < 12) return false;
  
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  return hasUpper && hasLower && hasDigit && hasSymbol;
}
