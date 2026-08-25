import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { listProviderApplications, type ProviderApplicationStatus } from "@/lib/provider-applications";

const STATUS_VALUES = ["pending", "approved", "declined"] as const;

function csvCell(value: string | null | undefined): string {
  const s = value ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Mirrors the queue's own status + search filters so "Export CSV" ships exactly the rows the
 * admin is currently looking at, not the whole table. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (STATUS_VALUES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as ProviderApplicationStatus)
    : undefined;
  const search = req.nextUrl.searchParams.get("q")?.trim() || undefined;

  const applications = await listProviderApplications({ status, search });

  const header = ["Company", "Email", "Contact", "Country", "Status", "Source", "Applied at"];
  const rows = applications.map((a) => [
    a.name,
    a.email,
    a.contactName ?? "",
    a.country ?? "",
    a.status,
    a.source,
    a.appliedAt.toISOString(),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="provider-applications-${status ?? "all"}.csv"`,
    },
  });
}
