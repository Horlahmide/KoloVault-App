"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { validatePassword, consumeIpRateLimit } from "@/lib/security";
import { headers } from "next/headers";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function register(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";

  // 1. Consume IP Rate Limit
  const isAllowed = await consumeIpRateLimit(ip);
  if (!isAllowed) {
    return { error: "Too many attempts. Please try again in 15 minutes." };
  }

  const result = RegisterSchema.safeParse({ email, password });
  if (!result.success) {
    return { error: "Invalid email or password format." };
  }

  if (!validatePassword(password)) {
    return { 
      error: "Password must be at least 12 characters long and include uppercase, lowercase, numbers, and symbols." 
    };
  }

  try {
    // To prevent timing attacks, we always hash the password before checking user existence.
    // This ensures that the response time is consistent regardless of whether the email is taken.
    const passwordHash = await hashPassword(password);

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // Generic error message to prevent account enumeration
      return { error: "Registration failed. Please try again with different credentials." };
    }

    await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });

    return { success: true };
  } catch (err) {
    console.error("Registration error:", err);
    return { error: "Registration failed. Please try again with different credentials." };
  }
}
