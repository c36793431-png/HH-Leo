export type ActionResult = { ok: true } | { ok: false; error: string };

export const IDLE_RESULT: ActionResult = { ok: true };

function messageFor(fallback: string, err: unknown): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Wraps an admin mutation so a thrown error becomes a serializable ActionResult instead of
 * crashing to Next's generic error boundary — callers already committed DB writes must still
 * get a clean success/failure signal back, not a blank "server error" page that invites retries. */
export async function runAction(fallbackError: string, fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageFor(fallbackError, err) };
  }
}
