// Governance, risk & compliance API for a workspace. Dispatches on
// "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { members, saveSettings, scope } from "@/server/grc/access";
import { addPack, deleteObligation, filings, markFiling, obligations, saveObligation } from "@/server/grc/calendar";
import { addEsg, deleteEsg, esg, fraud, home, sod } from "@/server/grc/checks";
import { importRisks, acknowledge, auditDetail, audits, controlDetail, controls, deleteRisk, incidentDetail, incidents, policies, policyDetail, publishPolicy, reportIncident, retirePolicy, riskDetail, risks, saveAudit, saveControl, saveFinding, savePolicy, saveRisk, testControl, updateIncident } from "@/server/grc/registers";
import { INDIA_PACK } from "@/lib/grc/model";
import { isPartOn } from "@/lib/workspace/modules";
import { can } from "@/server/authz/permissions";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, subId] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}${subId ? " :sub" : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return { me: { id: s.userId, role: s.role, registers: s.registers, write: s.write, manage: s.manage, finance: s.registers && can(s.role, "accounts:read") }, settings: s.settings, members: s.registers ? await members(orgId) : [], parts: Object.fromEntries(["risks", "calendar", "audits", "esg"].map((p) => [p, isPartOn(s.partsOff, "grc", p)])), pack: INDIA_PACK.map(({ key, title, authority, notes }) => ({ key, title, authority, notes })) };
    case "GET home":
      return home(s);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };

    case "GET risks":
      return { risks: await risks(s) };
    case "POST risks":
      return { risk: await saveRisk(s, null, await body(ctx)) };
    case "POST risks import":
      return importRisks(s, await readJson(ctx.req, z.unknown()));
    case "GET risks :id":
      return riskDetail(s, id!);
    case "PUT risks :id":
      return { risk: await saveRisk(s, id!, await body(ctx)) };
    case "DELETE risks :id":
      await deleteRisk(s, id!);
      return { ok: true };

    case "GET controls":
      return { controls: await controls(s) };
    case "POST controls":
      return { control: await saveControl(s, null, await body(ctx)) };
    case "GET controls :id":
      return controlDetail(s, id!);
    case "PUT controls :id":
      return { control: await saveControl(s, id!, await body(ctx)) };
    case "POST controls :id tests":
      return { test: await testControl(s, id!, await body(ctx)) };

    case "GET obligations":
      return { obligations: await obligations(s) };
    case "POST obligations":
      return { obligation: await saveObligation(s, null, await body(ctx)) };
    case "POST obligations pack":
      return addPack(s, await body(ctx));
    case "PUT obligations :id":
      return { obligation: await saveObligation(s, id!, await body(ctx)) };
    case "DELETE obligations :id":
      await deleteObligation(s, id!);
      return { ok: true };
    case "GET filings":
      return { filings: await filings(s, qs) };
    case "PUT filings :id":
      return { filing: await markFiling(s, id!, await body(ctx)) };

    case "GET policies":
      return { policies: await policies(s) };
    case "POST policies":
      return { policy: await savePolicy(s, null, await body(ctx)) };
    case "GET policies :id":
      return policyDetail(s, id!);
    case "PUT policies :id":
      return { policy: await savePolicy(s, id!, await body(ctx)) };
    case "POST policies :id publish":
      return { policy: await publishPolicy(s, id!) };
    case "POST policies :id retire":
      await retirePolicy(s, id!);
      return { ok: true };
    case "POST policies :id acknowledge":
      return acknowledge(s, id!);

    case "GET incidents":
      return { incidents: await incidents(s) };
    case "POST incidents":
      return { incident: await reportIncident(s, await body(ctx)) };
    case "GET incidents :id":
      return { incident: await incidentDetail(s, id!) };
    case "PATCH incidents :id":
      return { incident: await updateIncident(s, id!, await body(ctx)) };

    case "GET audits":
      return { audits: await audits(s) };
    case "POST audits":
      return { audit: await saveAudit(s, null, await body(ctx)) };
    case "GET audits :id":
      return auditDetail(s, id!);
    case "PUT audits :id":
      return { audit: await saveAudit(s, id!, await body(ctx)) };
    case "POST audits :id findings":
      return { finding: await saveFinding(s, id!, null, await body(ctx)) };
    case "PUT audits :id findings :sub":
      return { finding: await saveFinding(s, id!, subId!, await body(ctx)) };

    case "GET sod":
      return sod(s);
    case "GET fraud":
      return fraud(s);
    case "GET esg":
      return esg(s, qs);
    case "POST esg":
      return { entry: await addEsg(s, await body(ctx)) };
    case "DELETE esg :id":
      await deleteEsg(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
