// Marketing API for a workspace. Dispatches on "METHOD section :id sub",
// like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { saveSettings, scope } from "@/server/marketing/access";
import { attend, campaignDetail, campaigns, deleteSegment, home, previewSegment, registrations, saveCampaign, saveSegment, segments, sendCampaign, setStatus, utmLink } from "@/server/marketing/core";
import { owners } from "@/server/crm/access";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return { me: { id: s.userId, write: s.write, manage: s.manage }, settings: s.settings, owners: await owners(orgId) };
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);

    case "GET segments":
      return { segments: await segments(s) };
    case "POST segments":
      return { segment: await saveSegment(s, null, await body(ctx)) };
    case "POST segments preview":
      return previewSegment(s, await body(ctx));
    case "PUT segments :id":
      return { segment: await saveSegment(s, id!, await body(ctx)) };
    case "DELETE segments :id":
      await deleteSegment(s, id!);
      return { ok: true };

    case "GET campaigns":
      return { campaigns: await campaigns(s, qs) };
    case "POST campaigns":
      return { campaign: await saveCampaign(s, null, await body(ctx)) };
    case "GET campaigns :id":
      return campaignDetail(s, id!);
    case "PUT campaigns :id":
      return { campaign: await saveCampaign(s, id!, await body(ctx)) };
    case "POST campaigns :id status":
      return setStatus(s, id!, await body(ctx));
    case "POST campaigns :id send":
      return sendCampaign(s, id!, await body(ctx));
    case "POST campaigns :id utm":
      return utmLink(s, id!, await body(ctx));
    case "GET campaigns :id registrations":
      return { registrations: await registrations(s, id!) };
    case "POST campaigns :id attend":
      return { registration: await attend(s, id!, await body(ctx)) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
