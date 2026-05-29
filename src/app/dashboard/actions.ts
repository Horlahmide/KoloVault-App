"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const EntrySchema = z.object({
  amount: z.number().positive(),
  note: z.string().min(1).max(255),
  date: z.string(),
});

export async function addEntry(formData: FormData) {
  const user = await validateSession();
  if (!user) return { error: "Unauthorized" };

  const amount = parseFloat(formData.get("amount") as string);
  const note = formData.get("note") as string;
  const date = formData.get("date") as string;

  const result = EntrySchema.safeParse({ amount, note, date });
  if (!result.success) {
    return { error: "Invalid entry data." };
  }

  try {
    await prisma.entry.create({
      data: {
        userId: user.id,
        amount,
        note,
        date: new Date(date),
      },
    });

    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    console.error("Add entry error:", err);
    return { error: "Failed to add entry." };
  }
}

export async function updateGoal(formData: FormData) {
  const user = await validateSession();
  if (!user) return { error: "Unauthorized" };

  const targetAmount = parseFloat(formData.get("targetAmount") as string);
  if (isNaN(targetAmount) || targetAmount < 0) {
    return { error: "Invalid goal amount." };
  }

  try {
    await prisma.goal.upsert({
      where: { userId: user.id },
      update: { targetAmount },
      create: { userId: user.id, targetAmount },
    });

    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    console.error("Update goal error:", err);
    return { error: "Failed to update goal." };
  }
}
