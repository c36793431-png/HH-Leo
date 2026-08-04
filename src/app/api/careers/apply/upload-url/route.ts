import { NextRequest, NextResponse } from "next/server";
import { generateApplicationCvUploadToken, ALLOWED_CV_CONTENT_TYPES } from "@/lib/applications";

/** Public — no auth, this is the public /careers apply flow. Only mints a scoped, content-type
 * and size-restricted Blob token; the actual application row (and the real rate limit) is only
 * written by submitApplicationAction after upload completes. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const filename = body?.filename;
  const contentType = body?.contentType;

  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }
  if (typeof contentType !== "string" || !ALLOWED_CV_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "CV must be a PDF or DOCX file" }, { status: 400 });
  }

  try {
    const { token, pathname } = await generateApplicationCvUploadToken(filename);
    return NextResponse.json({ token, pathname });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to generate upload token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
