"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/security";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function register(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

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
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // Generic error message to prevent account enumeration
      return { error: "Registration failed. Please try again with different credentials." };
    }

    const passwordHash = await hashPassword(password);

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
