"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import {
  createSetfile,
  updateSetfile,
  setSetfileActive,
  deleteSetfile,
  moveSetfile,
  type StrategyKey,
  type SetfileSource,
} from "@/lib/setfiles";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";

const STRATEGY_KEYS: StrategyKey[] = ["1leg", "2leg_lock", "trend_impulse", "obi", "grid"];
const SOURCES: SetfileSource[] = ["verified", "example"];

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

function readSetfileForm(formData: FormData) {
  const strategyKey = formData.get("strategyKey") as string;
  const source = formData.get("source") as string;
  const name = (formData.get("name") as string)?.trim();
  const subtitle = (formData.get("subtitle") as string)?.trim();
  if (!STRATEGY_KEYS.includes(strategyKey as StrategyKey)) throw new Error("Invalid strategy");
  if (!SOURCES.includes(source as SetfileSource)) throw new Error("Invalid source");
  if (!name) throw new Error("Name is required");
  if (!subtitle) throw new Error("Subtitle is required");

  return {
    strategyKey: strategyKey as StrategyKey,
    source: source as SetfileSource,
    name,
    subtitle,
    explanation: (formData.get("explanation") as string) ?? "",
    params: (formData.get("params") as string) ?? "",
    sessionWindow: (formData.get("sessionWindow") as string)?.trim() || null,
    warnings: (formData.get("warnings") as string)?.trim() || null,
  };
}

function revalidateSetfilePaths() {
  revalidatePath("/admin/setfiles");
  revalidatePath("/setfiles");
}

export async function createSetfileAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to create setfile", async () => {
    const adminUserId = await requireAdmin();
    const input = readSetfileForm(formData);
    const created = await createSetfile(input, adminUserId);
    await logAdminAction(adminUserId, "create_setfile", null, { setfileId: created.id });
    revalidateSetfilePaths();
  });
}

export async function updateSetfileAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update setfile", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    const input = readSetfileForm(formData);
    await updateSetfile(id, input, adminUserId);
    await logAdminAction(adminUserId, "update_setfile", null, { setfileId: id });
    revalidateSetfilePaths();
  });
}

export async function toggleSetfileActiveAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update setfile", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    const active = formData.get("active") === "true";
    await setSetfileActive(id, active);
    await logAdminAction(adminUserId, active ? "enable_setfile" : "disable_setfile", null, { setfileId: id });
    revalidateSetfilePaths();
  });
}

export async function deleteSetfileAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to delete setfile", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    await deleteSetfile(id);
    await logAdminAction(adminUserId, "delete_setfile", null, { setfileId: id });
    revalidateSetfilePaths();
  });
}

export async function moveSetfileAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to reorder setfile", async () => {
    await requireAdmin();
    const id = formData.get("id") as string;
    const direction = formData.get("direction") as "up" | "down";
    await moveSetfile(id, direction);
    revalidateSetfilePaths();
  });
}
