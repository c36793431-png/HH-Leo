import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPaidUser } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getDownloadByVersionPlatform, type Platform } from "@/lib/downloads";
import { signDownloadToken } from "@/lib/download-token";

const PLATFORMS: Platform[] = ["windows", "macos"];

/** License-gated entry point: verifies the session is paid/admin, then 302s to a 5-minute signed link — never hands back the raw Blob URL. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const platform = req.nextUrl.searchParams.get("platform");
  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "platform must be windows or macos" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const paid = (await isPaidUser(session.user.id).catch(() => false)) || isAdminUser(session.user);
  if (!paid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const download = await getDownloadByVersionPlatform(version, platform as Platform);
  if (!download) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { token, expires } = signDownloadToken(session.user.id, download.id);
  const url = new URL("/api/download/file", req.nextUrl.origin);
  url.searchParams.set("id", download.id);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("token", token);

  return NextResponse.redirect(url, { status: 302 });
}
