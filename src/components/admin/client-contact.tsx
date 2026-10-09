// How an admin page shows a client (coxwell 10-06 via marcus m61859 part 7, m61876): every contact we hold, the
// Telegram @username as a one-tap t.me link, and whether we can actually reach them, labelled with what that is
// based on. Never "email -": no contact at all says so plainly. Admin pages only; nothing here reaches a provider.
import { reachability, ONBOARDING_GOALS, type OnboardingGoal } from "@/lib/client-reach";

export interface AdminClientContactProps {
  email: string | null;
  telegramUsername: string | null;
  telegramUserId: string | null;
  botStartedAt: Date | null;
  tgLastDmAt: Date | null;
  tgLastDmOk: boolean | null;
  tgLastDmError: string | null;
  /** The handle typed on a basket request, shown when it differs from the account's @username. */
  typedHandle?: string | null;
  /** undefined = don't show the welcome answer row (e.g. the basket list). */
  onboardingGoal?: OnboardingGoal | null;
}

const clean = (h: string | null | undefined) => (h ?? "").replace(/^@/, "");
const linkable = (u: string) => /^[A-Za-z0-9_]{3,32}$/.test(u);

export function AdminClientContact(p: AdminClientContactProps) {
  const r = reachability(p);
  const username = clean(p.telegramUsername);
  const typed = clean(p.typedHandle);
  const typedDiffers = typed && typed.toLowerCase() !== username.toLowerCase();

  if (!p.email && !username && !p.telegramUserId && !typed) {
    return <div className="text-xs font-medium text-red-400">No contact: client can&apos;t be reached</div>;
  }
  return (
    <div className="space-y-0.5 text-xs">
      {p.email && <div className="text-zinc-400">{p.email}</div>}
      {username ? (
        <div>
          telegram:{" "}
          {linkable(username) ? (
            <a href={`https://t.me/${username}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
              @{username}
            </a>
          ) : (
            <span className="text-zinc-300">@{username}</span>
          )}
        </div>
      ) : (
        <div className="text-zinc-500">telegram: {p.telegramUserId ? "no @username" : "none on file"}</div>
      )}
      {typedDiffers && (
        <div className="text-zinc-500">
          typed on request:{" "}
          {linkable(typed) ? (
            <a href={`https://t.me/${typed}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
              @{typed}
            </a>
          ) : (
            `@${typed}`
          )}
        </div>
      )}
      <div className={r.reachable ? "text-emerald-400" : "font-medium text-amber-400"}>{r.label}</div>
      {p.onboardingGoal !== undefined && (
        <div className="text-zinc-500">wants: {p.onboardingGoal ? ONBOARDING_GOALS[p.onboardingGoal] : "not answered yet"}</div>
      )}
    </div>
  );
}
