"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  updateStrategySubmissionStatus,
  updateStrategySubmissionNotes,
  STRATEGY_SUBMISSION_STATUSES,
  type StrategySubmissionStatus,
} from "@/lib/strategy-submissions";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
}

export async function setStrategySubmissionStatusAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update status", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;
    if (!STRATEGY_SUBMISSION_STATUSES.includes(status as StrategySubmissionStatus)) throw new Error("Invalid status");
    await updateStrategySubmissionStatus(id, status as StrategySubmissionStatus);
    revalidatePath("/admin/strategy-submissions");
  });
}

export async function setStrategySubmissionNotesAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save notes", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const notes = ((formData.get("notes") as string) ?? "").trim();
    await updateStrategySubmissionNotes(id, notes === "" ? null : notes);
    revalidatePath("/admin/strategy-submissions");
  });
}
