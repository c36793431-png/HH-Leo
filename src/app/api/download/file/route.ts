import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isPaidUser } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { verifyDownloadToken } from "@/lib/download-token";
import { getDownloadById } from "@/lib/downloads";

/** Streams the private Blob content server-side — the Blob store is never reachable directly by the browser. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const expiresParam = req.nextUrl.searchParams.get("expires");
  const token = req.nextUrl.searchParams.get("token");
  if (!id || !expiresParam || !token) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const expires = Number(expiresParam);
  if (!Number.isFinite(expires) || !verifyDownloadToken(session.user.id, id, expires, token)) {
    return NextResponse.json({ error: "link expired" }, { status: 403 });
  }

  const paid = (await isPaidUser(session.user.id).catch(() => false)) || isAdminUser(session.user);
  if (!paid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const download = await getDownloadById(id);
  if (!download) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const blob = await get(download.blobPathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "installer fetch failed" }, { status: 502 });
  }

  const filename = download.blobPathname.split("/").pop() ?? `horizon-hft-${download.version}`;
  return new NextResponse(blob.stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
