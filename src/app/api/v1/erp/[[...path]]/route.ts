import { handleErp } from "@/server/hub/api";

/**
 * The workspace ERP API for other systems. Server-to-server: no cookies, no
 * Origin check; a workspace API key (bearer) is the credential.
 */
type Ctx = { params: Promise<{ path?: string[] }> };
export async function GET(req: Request, { params }: Ctx) {
  return handleErp(req, (await params).path ?? []);
}
export async function POST(req: Request, { params }: Ctx) {
  return handleErp(req, (await params).path ?? []);
}
