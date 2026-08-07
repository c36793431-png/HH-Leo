"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  updateStrategyRequestStatus,
  updateStrategyRequestNotes,
  STRATEGY_REQUEST_STATUSES,
  type StrategyRequestStatus,
} from "@/lib/strategy-requests";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
}

export async function setStrategyRequestStatusAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update status", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;
    if (!STRATEGY_REQUEST_STATUSES.includes(status as StrategyRequestStatus)) throw new Error("Invalid status");
    await updateStrategyRequestStatus(id, status as StrategyRequestStatus);
    revalidatePath("/admin/strategy-requests");
  });
}

export async function setStrategyRequestNotesAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save notes", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const notes = ((formData.get("notes") as string) ?? "").trim();
    await updateStrategyRequestNotes(id, notes === "" ? null : notes);
    revalidatePath("/admin/strategy-requests");
  });
}
