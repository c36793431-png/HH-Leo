import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPaidUser } from "@/lib/licenses";
import { signDownloadToken } from "@/lib/download-token";

/** Never expose the raw Blob URL — hand back a short-lived link into /api/installer/file instead. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const paid = await isPaidUser(session.user.id);
  if (!paid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { token, expires } = signDownloadToken(session.user.id);
  const url = `/api/installer/file?uid=${encodeURIComponent(session.user.id)}&expires=${expires}&token=${encodeURIComponent(token)}`;
  return NextResponse.json({ url, expiresAt: new Date(expires).toISOString() });
}
