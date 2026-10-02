"use server";

import { revalidatePath } from "next/cache";
import { requireRole, revokeSession } from "../auth";

export async function revokeSessionAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const sessionId = String(formData.get("sessionId") ?? "");
  await revokeSession(session.sub, sessionId);
  revalidatePath("/sessions");
}
