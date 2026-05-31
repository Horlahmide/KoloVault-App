"use server";

import { prisma } from "@/lib/prisma";
import { hashPassword, hashToken } from "@/lib/auth";
import { validatePassword } from "@/lib/security";

export async function resetPassword(formData: FormData) {
  const token = formData.get("token") as string;
  const password = formData.get("password") as string;

  if (!token) return { error: "Invalid token." };

  if (!validatePassword(password)) {
    return { 
      error: "Password must be at least 12 characters long and include uppercase, lowercase, numbers, and symbols." 
    };
  }

  try {
    const tokenHash = hashToken(token);

    const user = await prisma.user.findFirst({
      where: {
        resetToken: tokenHash,
        resetExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return { error: "Invalid or expired reset token." };
    }

    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetExpires: null,
        failedAttempts: 0,
        lockoutUntil: null,
      },
    });

    // We also invalidate all sessions for this user for safety
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });

    return { success: true };
  } catch (err) {
    console.error("Reset password error:", err);
    return { error: "An error occurred during password reset." };
  }
}
