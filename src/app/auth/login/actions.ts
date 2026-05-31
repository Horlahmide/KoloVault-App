"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { 
  consumeIpRateLimit, 
  handleFailedLogin, 
  resetFailedLogin 
} from "@/lib/security";
import { headers } from "next/headers";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
  const userAgent = headersList.get("user-agent") || undefined;

  // 1. Consume IP Rate Limit (Atomic check and increment)
  const isAllowed = await consumeIpRateLimit(ip);
  if (!isAllowed) {
    return { error: "Too many attempts. Please try again in 15 minutes." };
  }

  const result = LoginSchema.safeParse({ email, password });
  if (!result.success) {
    return { error: "Invalid email or password." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // To prevent timing attacks, we always perform a password verification.
    // If the user doesn't exist, we verify against a dummy hash.
    const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$42/lH3zYtO8vX7S9Y7fJ8w$fH3zYtO8vX7S9Y7fJ8w42/lH3zYtO8vX7S9Y7fJ8w";
    const passwordToVerify = user ? user.passwordHash : DUMMY_HASH;
    const isValid = await verifyPassword(password, passwordToVerify);

    if (!user || !isValid) {
      // If the user exists but the password was wrong, we record a failed attempt
      if (user && !isValid) {
        await handleFailedLogin(user.id);
      }
      return { error: "Invalid email or password." };
    }

    // 2. Check Account Lockout
    // We use a generic message to prevent account enumeration via lockout state
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      return { error: "Access denied. Please check your credentials or try again later." };
    }

    // Success
    await resetFailedLogin(user.id);
    await createSession(user.id, userAgent, ip);

    return { success: true };
  } catch (err) {
    console.error("Login error:", err);
    return { error: "An error occurred during login." };
  }
}
