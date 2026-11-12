// Outreach's part of the platform console API (/api/v1/admin/outreach/…).
// Reading needs outreach:read; changing anything needs outreach:write, and
// the settings (which switch sending on) need a fresh password too. Changes
// are written to the audit log.
import { z } from "zod";
import type { PlatformPerm } from "@/lib/platform/admin-roles";
import { readJson, type AuthedContext } from "../http/handler";
import { notFound } from "../http/errors";
import { rateLimit } from "../security/rate-limit";
import { audit } from "../services/audit";
import { activityFeed, archiveTemplate, contactDetail, contacts, deleteContacts, deleteFunnel, funnelDetail, funnels, getSettings, importContacts, outreachTick, overview, pasteContacts, preview, saveFunnel, saveSettings, saveTemplate, setFunnelStatus, templates, testSend, updateContact } from "./core";

type Need = (perm: PlatformPerm, fresh?: boolean) => Promise<string>;
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);

export async function outreachApi(ctx: AuthedContext, need: Need, rest: string[], qs: Record<string, string>) {
  const [area, a, b] = rest;
  const key = `${ctx.req.method} ${area ?? ""}${a ? (isId(a) ? " :id" : ` ${a}`) : ""}${b ? ` ${b}` : ""}`;
  const read = () => need("outreach:read");
  const write = () => need("outreach:write");
  const log = (actorId: string, action: string, targetId?: string, metadata?: Record<string, unknown>) => audit({ actorId, action: `platform.outreach_${action}`, targetType: "outreach", ...(targetId ? { targetId } : {}), ...(metadata ? { metadata } : {}) });
  switch (key) {
    case "GET overview":
      await read();
      return overview();
    case "GET activity":
      await read();
      return { events: await activityFeed(Number(qs.limit) || 100) };

    case "GET contacts":
      await read();
      return contacts(qs);
    case "GET contacts :id":
      await read();
      return contactDetail(a!);
    case "PATCH contacts :id":
      await write();
      return { contact: await updateContact(a!, await body(ctx)) };
    case "POST contacts import": {
      const me = await write();
      await rateLimit(`outreach-import:${me}`, 60, 3_600_000);
      const r = await importContacts(await body(ctx));
      await log(me, "import", undefined, { created: r.created, updated: r.updated, skipped: r.skipped });
      return r;
    }
    case "POST contacts paste": {
      const me = await write();
      await rateLimit(`outreach-import:${me}`, 60, 3_600_000);
      const r = await pasteContacts(await body(ctx));
      await log(me, "import", undefined, { created: r.created, updated: r.updated, skipped: r.skipped, pasted: true });
      return r;
    }
    case "POST contacts delete": {
      const me = await need("outreach:write", true);
      const r = await deleteContacts(await body(ctx));
      await log(me, "contacts_deleted", undefined, r);
      return r;
    }

    case "GET templates":
      await read();
      return templates();
    case "POST templates":
      await write();
      return { template: await saveTemplate(null, await body(ctx)) };
    case "PUT templates :id":
      await write();
      return { template: await saveTemplate(a!, await body(ctx)) };
    case "DELETE templates :id":
      await write();
      return archiveTemplate(a!);
    case "POST templates preview":
      await read();
      return preview(await body(ctx));
    case "POST templates test": {
      const me = await write();
      await rateLimit(`outreach-test:${me}`, 30, 3_600_000);
      return testSend(await body(ctx));
    }

    case "GET funnels":
      await read();
      return funnels();
    case "GET funnels :id":
      await read();
      return funnelDetail(a!);
    case "POST funnels":
      await write();
      return { funnel: await saveFunnel(null, await body(ctx)) };
    case "PUT funnels :id":
      await write();
      return { funnel: await saveFunnel(a!, await body(ctx)) };
    case "POST funnels :id start": {
      const me = await write();
      const r = await setFunnelStatus(a!, "active");
      await log(me, "funnel_started", a, { enrolled: r.enrolled });
      return r;
    }
    case "POST funnels :id pause": {
      const me = await write();
      const r = await setFunnelStatus(a!, "paused");
      await log(me, "funnel_paused", a);
      return r;
    }
    case "DELETE funnels :id": {
      const me = await write();
      await log(me, "funnel_deleted", a);
      return deleteFunnel(a!);
    }

    case "GET settings":
      await read();
      return { settings: await getSettings() };
    case "PUT settings": {
      const me = await need("outreach:write", true);
      const s = await saveSettings(me, await body(ctx));
      await log(me, "settings", undefined, { sending: s.sending, dailyLimit: s.dailyLimit });
      return { settings: s };
    }
    // Runs the engine once now (it also runs on its own every few minutes).
    case "POST run": {
      const me = await write();
      await rateLimit(`outreach-run:${me}`, 30, 3_600_000);
      return outreachTick();
    }
  }
  throw notFound("Route");
}
