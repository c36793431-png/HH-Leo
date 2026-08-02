import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { generateDownloadUploadToken, PLATFORMS, type Platform } from "@/lib/downloads";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const version = body?.version;
  const platform = body?.platform;
  const filename = body?.filename;

  if (typeof version !== "string" || !version) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "platform must be windows or macos" }, { status: 400 });
  }
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  try {
    const { token, pathname } = await generateDownloadUploadToken({
      version,
      platform: platform as Platform,
      filename,
    });

    return NextResponse.json({ token, pathname });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to generate upload token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
