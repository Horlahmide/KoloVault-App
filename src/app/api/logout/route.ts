import { invalidateSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function POST() {
  await invalidateSession();
  redirect("/auth/login");
}
