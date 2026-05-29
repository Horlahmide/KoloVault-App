"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { 
  checkIpRateLimit, 
  incrementIpRateLimit, 
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

  // 1. Check IP Rate Limit
  const isAllowed = await checkIpRateLimit(ip);
  if (!isAllowed) {
    return { error: "Too many attempts. Please try again in 15 minutes." };
  }

  const result = LoginSchema.safeParse({ email, password });
  if (!result.success) {
    await incrementIpRateLimit(ip);
    return { error: "Invalid email or password." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Increment IP rate limit and return generic error
      await incrementIpRateLimit(ip);
      return { error: "Invalid email or password." };
    }

    // 2. Check Account Lockout
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      return { error: "Account temporarily locked. Please try again in an hour." };
    }

    const isValid = await verifyPassword(password, user.passwordHash);

    if (!isValid) {
      await incrementIpRateLimit(ip);
      await handleFailedLogin(user.id);
      return { error: "Invalid email or password." };
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
