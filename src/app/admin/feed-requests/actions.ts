"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  updateFeedRequestStatus,
  updateFeedRequestNotes,
  FEED_REQUEST_STATUSES,
  type FeedRequestStatus,
} from "@/lib/feed-requests";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
}

export async function setFeedRequestStatusAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update status", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;
    if (!FEED_REQUEST_STATUSES.includes(status as FeedRequestStatus)) throw new Error("Invalid status");
    await updateFeedRequestStatus(id, status as FeedRequestStatus);
    revalidatePath("/admin/feed-requests");
  });
}

export async function setFeedRequestNotesAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save notes", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const notes = ((formData.get("notes") as string) ?? "").trim();
    await updateFeedRequestNotes(id, notes === "" ? null : notes);
    revalidatePath("/admin/feed-requests");
  });
}
