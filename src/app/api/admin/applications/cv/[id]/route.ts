import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getApplicationById, getCvBlobStream } from "@/lib/applications";

/** Streams the private CV blob server-side — admin-only, the Blob store is never reachable
 * directly by the browser. Mirrors /api/download/file. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const application = await getApplicationById(id);
  if (!application || !application.cvUrl) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const blob = await getCvBlobStream(application.cvUrl);
  if (!blob) {
    return NextResponse.json({ error: "CV fetch failed" }, { status: 502 });
  }

  const filename = application.cvUrl.split("/").pop() ?? `cv-${application.id}`;
  return new NextResponse(blob.stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
