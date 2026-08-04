"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { updateApplicationStatus, updateApplicationNotes, APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/applications";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
}

export async function setApplicationStatusAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update status", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;
    if (!APPLICATION_STATUSES.includes(status as ApplicationStatus)) throw new Error("Invalid status");
    await updateApplicationStatus(id, status as ApplicationStatus);
    revalidatePath("/admin/applications");
  });
}

export async function setApplicationNotesAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save notes", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const notes = ((formData.get("notes") as string) ?? "").trim();
    await updateApplicationNotes(id, notes === "" ? null : notes);
    revalidatePath("/admin/applications");
  });
}
