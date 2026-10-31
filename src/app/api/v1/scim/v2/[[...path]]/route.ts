import { handleScim } from "@/server/auth/scim";
import { rateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/http/handler";

/** SCIM 2.0 for identity providers. Server-to-server: the workspace's SCIM bearer token is the credential. */
type Ctx = { params: Promise<{ path?: string[] }> };
async function h(req: Request, { params }: Ctx) {
  try {
    await rateLimit(`scim:${clientIp(req) ?? "?"}`, 600, 60_000);
  } catch {
    return Response.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "429", detail: "Too many requests" }, { status: 429 });
  }
  return handleScim(req, (await params).path ?? []);
}
export const GET = h;
export const POST = h;
export const PUT = h;
export const PATCH = h;
export const DELETE = h;
