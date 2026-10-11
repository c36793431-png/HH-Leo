"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { setClientLogin, setFeedTierConnection } from "@/lib/feed-connections";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

/** One tier's row for one connection type. The audit row is written by setFeedTierConnection in the same
 * transaction (Fable N2). */
export async function setFeedTierConnectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to save the connection", async () => {
    const adminId = await requireAdmin();
    await setFeedTierConnection(
      {
        feedTierId: field(formData, "feedTierId"),
        connType: field(formData, "connType"),
        host: field(formData, "host"),
        port: field(formData, "port"),
        dataType: field(formData, "dataType"),
        sessionHours: field(formData, "sessionHours"),
        symbols: field(formData, "symbols"),
      },
      adminId
    );
    revalidatePath("/admin/feed-connections");
  });
}

/** One client's username for one connection type of a tier; an empty name clears it. Audited in the same
 * transaction, with the client as the target (Fable N2). */
export async function setClientLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to save the username", async () => {
    const adminId = await requireAdmin();
    const userId = field(formData, "userId");
    await setClientLogin(
      { userId, feedTierId: field(formData, "feedTierId"), connType: field(formData, "connType"), username: field(formData, "username") },
      adminId
    );
    revalidatePath(`/admin/users/${userId}`);
  });
}
