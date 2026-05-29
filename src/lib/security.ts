import { prisma } from "./prisma";

const IP_RATE_LIMIT_MAX = 5;
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const ACCOUNT_LOCKOUT_MAX = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkIpRateLimit(ip: string): Promise<boolean> {
  const key = `login:ip:${ip}`;
  const record = await prisma.rateLimit.findUnique({
    where: { key },
  });

  if (!record) return true;

  const now = Date.now();
  const lastAttempt = record.lastAttempt.getTime();

  if (now - lastAttempt > IP_RATE_LIMIT_WINDOW_MS) {
    // Reset if window passed
    await prisma.rateLimit.update({
      where: { key },
      data: { count: 0, lastAttempt: new Date() },
    });
    return true;
  }

  return record.count < IP_RATE_LIMIT_MAX;
}

export async function incrementIpRateLimit(ip: string) {
  const key = `login:ip:${ip}`;
  const now = new Date();

  await prisma.rateLimit.upsert({
    where: { key },
    update: {
      count: { increment: 1 },
      lastAttempt: now,
    },
    create: {
      key,
      count: 1,
      lastAttempt: now,
    },
  });
}

export async function handleFailedLogin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedAttempts: true },
  });

  if (!user) return;

  const newAttempts = user.failedAttempts + 1;
  let lockoutUntil: Date | null = null;

  if (newAttempts >= ACCOUNT_LOCKOUT_MAX) {
    lockoutUntil = new Date(Date.now() + ACCOUNT_LOCKOUT_WINDOW_MS);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      failedAttempts: newAttempts,
      lockoutUntil,
    },
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
