"use server";

import { validateSession, logoutEverywhere } from "@/lib/auth";

export async function handleLogoutEverywhere() {
  const user = await validateSession();
  if (!user) return { error: "Unauthorized" };

  try {
    await logoutEverywhere(user.id);
    return { success: true };
  } catch (err) {
    console.error("Logout everywhere error:", err);
    return { error: "Failed to logout from all devices." };
  }
}
