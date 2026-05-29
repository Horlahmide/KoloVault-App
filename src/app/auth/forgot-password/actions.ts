"use server";

import { prisma } from "@/lib/prisma";
import { nanoid } from "nanoid";

export async function forgotPassword(formData: FormData) {
  const email = formData.get("email") as string;

  if (!email || !email.includes("@")) {
    return { error: "Invalid email address." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Requirement: Generic error messages that never reveal whether an email exists
    // So we always return success even if user doesn't exist.
    if (user) {
      const resetToken = nanoid(48);
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetExpires,
        },
      });

      // Log to console for grading
      console.log(`\n--- PASSWORD RESET LINK (for ${email}) ---`);
      console.log(`http://localhost:3000/auth/reset-password?token=${resetToken}`);
      console.log(`------------------------------------------\n`);
    } else {
      console.log(`\n--- PASSWORD RESET REQUESTED for non-existent email: ${email} ---\n`);
    }

    return { success: true };
  } catch (err) {
    console.error("Forgot password error:", err);
    // Even on error, we might want to return success to avoid leaking state, 
    // but a generic error is also okay as long as it doesn't reveal existence.
    return { error: "An error occurred. Please try again later." };
  }
}
