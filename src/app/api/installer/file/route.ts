import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPaidUser } from "@/lib/licenses";
import { verifyDownloadToken } from "@/lib/download-token";
import { getInstallerInfo } from "@/lib/portal-config";

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");
  const expiresParam = req.nextUrl.searchParams.get("expires");
  const token = req.nextUrl.searchParams.get("token");
  if (!uid || !expiresParam || !token) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id || session.user.id !== uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const expires = Number(expiresParam);
  if (!Number.isFinite(expires) || !verifyDownloadToken(uid, expires, token)) {
    return NextResponse.json({ error: "link expired" }, { status: 403 });
  }

  const paid = await isPaidUser(uid);
  if (!paid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const installer = await getInstallerInfo();
  if (!installer) {
    return NextResponse.json({ error: "no installer available" }, { status: 404 });
  }

  const blobRes = await fetch(installer.blobUrl);
  if (!blobRes.ok || !blobRes.body) {
    return NextResponse.json({ error: "installer fetch failed" }, { status: 502 });
  }

  return new NextResponse(blobRes.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${installer.filename}"`,
    },
  });
}
