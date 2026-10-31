// CRM API for a workspace. Everything is scoped to the organization and to
// what the member's role (and the workspace's visibility setting) allows.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl, mailProvider } from "@/server/services/mail";
import { check, createPipeline, deletePipeline, fields, owners, pipelines, requireManage, requireWrite, rotateCaptureToken, saveSettings, scope, updatePipeline, visible, type Scope } from "@/server/crm/access";
import { createActivity, deleteActivity, emailContact, tasks, updateActivity } from "@/server/crm/activities";
import { syncAll } from "@/server/crm/capture";
import { deleteCompany, getCompany, listCompanies, saveCompany } from "@/server/crm/companies";
import { bulkContacts, contactIdsFor, createContact, deleteContacts, duplicateGroups, getContact, listContacts, mergeContacts, tagsInUse, updateContact } from "@/server/crm/contacts";
import { board, createDeal, deleteDeal, getDeal, listDeals, moveDeal, updateDeal } from "@/server/crm/deals";
import { deleteField, deleteView, exportContacts, exportDeals, importContacts, saveField, saveView, views } from "@/server/crm/io";
import { home, salesReport } from "@/server/crm/reports";
import { deleteSequence, enroll, getSequence, listSequences, saveSequence, stopEnrollment } from "@/server/crm/sequences";
import { rescoreAll } from "@/server/crm/timeline";
import { pipelineSchema } from "@/lib/crm/model";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const csv = (name: string, text: string) => new Response("﻿" + text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });

async function search(s: Scope, q: string) {
  const t = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const digits = q.replace(/\D/g, "");
  const [contacts, companies, deals] = await Promise.all([
    db
      .select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, phone: schema.crmContacts.phone, lifecycle: schema.crmContacts.lifecycle })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.orgId, s.orgId), visible(s, schema.crmContacts.ownerId), or(ilike(schema.crmContacts.name, t), ilike(schema.crmContacts.email, t), digits.length >= 4 ? sql`regexp_replace(${schema.crmContacts.phone}, '\\D', '', 'g') like ${"%" + digits + "%"}` : undefined)))
      .limit(6),
    db.select({ id: schema.crmCompanies.id, name: schema.crmCompanies.name, domain: schema.crmCompanies.domain }).from(schema.crmCompanies).where(and(eq(schema.crmCompanies.orgId, s.orgId), visible(s, schema.crmCompanies.ownerId), or(ilike(schema.crmCompanies.name, t), ilike(schema.crmCompanies.domain, t)))).limit(4),
    db.select({ id: schema.crmDeals.id, title: schema.crmDeals.title, value: schema.crmDeals.value, status: schema.crmDeals.status }).from(schema.crmDeals).where(and(eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId), ilike(schema.crmDeals.title, t))).limit(4),
  ]);
  return { contacts, companies, deals };
}

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const url = new URL(ctx.req.url);
  const qs = Object.fromEntries(url.searchParams);
  const key = `${m} ${section ?? ""}${id ? " :id" : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta": {
      const [ps, fs, people, tags] = await Promise.all([pipelines(orgId), fields(orgId), owners(orgId), tagsInUse(s)]);
      const { captureToken, rrCursor: _, ...settings } = s.settings;
      void _;
      return {
        me: { id: s.userId, role: s.role, manage: s.manage, write: s.write, own: s.own },
        settings: { ...settings, captureUrl: s.manage ? appUrl(`/api/v1/crm/capture/${captureToken}`) : null },
        pipelines: ps,
        fields: fs,
        owners: people.map((p) => ({ id: p.id, name: p.name, email: p.email, canOwn: p.canOwn })),
        tags,
        mail: mailProvider() === "outbox" ? "outbox" : "live",
      };
    }
    case "PUT settings": {
      const before = JSON.stringify(s.settings.settings.scoring);
      const st = await saveSettings(s, await body(ctx));
      if (JSON.stringify(st.settings.scoring) !== before) await rescoreAll(orgId);
      return { ok: true };
    }
    case "POST settings :id":
      if (id === "token") return { url: appUrl(`/api/v1/crm/capture/${await rotateCaptureToken(s)}`) };
      throw notFound("Route");
    case "GET search":
      return search(s, (qs.q ?? "").slice(0, 80));
    case "GET home":
      return home(s);

    // ─── Contacts ───
    case "GET contacts":
      return listContacts(s, qs);
    case "POST contacts":
      return { contact: await createContact(s, await body(ctx)) };
    case "GET contacts :id":
      if (id === "duplicates") return { groups: await duplicateGroups(s) };
      if (id === "export") return csv("contacts.csv", await exportContacts(s, qs));
      return getContact(s, id);
    case "PUT contacts :id":
      return { contact: await updateContact(s, id, await body(ctx)) };
    case "DELETE contacts :id":
      return { deleted: await deleteContacts(s, [id]) };
    case "POST contacts :id": {
      const b = await body(ctx);
      if (id === "bulk") {
        // Either chosen ids, or "everything matching these filters".
        const ids = Array.isArray(b.ids) ? b.ids : b.query ? await contactIdsFor(s, b.query) : [];
        return bulkContacts(s, { ids, action: b.action, value: b.value });
      }
      if (id === "merge") return mergeContacts(s, String(b.keepId ?? ""), Array.isArray(b.otherIds) ? b.otherIds.map(String) : []);
      if (id === "import") {
        await rateLimit(`crm-import:${ctx.user.id}`, 60, 3600_000);
        return importContacts(s, b);
      }
      throw notFound("Route");
    }
    case "POST contacts :id email": {
      const b = await body(ctx);
      return emailContact(s, id, { subject: String(b.subject ?? ""), body: String(b.body ?? ""), dealId: typeof b.dealId === "string" ? b.dealId : null });
    }

    // ─── Companies ───
    case "GET companies":
      return listCompanies(s, { q: qs.q, page: Number(qs.page) || 1, per: Number(qs.per) || 50 });
    case "POST companies":
      return { company: await saveCompany(s, await body(ctx)) };
    case "GET companies :id":
      return getCompany(s, id);
    case "PUT companies :id":
      return { company: await saveCompany(s, await body(ctx), id) };
    case "DELETE companies :id":
      await deleteCompany(s, id);
      return { ok: true };

    // ─── Deals ───
    case "GET deals":
      return listDeals(s, { q: qs.q, status: qs.status, owner: qs.owner, pipelineId: qs.pipelineId, page: Number(qs.page) || 1, per: Number(qs.per) || 50 });
    case "POST deals":
      return { deal: await createDeal(s, await body(ctx)) };
    case "GET deals :id":
      if (id === "board") return board(s, { pipelineId: qs.pipelineId, owner: qs.owner, q: qs.q, status: qs.status });
      if (id === "export") return csv("deals.csv", await exportDeals(s));
      return getDeal(s, id);
    case "PUT deals :id":
      return { deal: await updateDeal(s, id, await body(ctx)) };
    case "POST deals :id move": {
      const b = await body(ctx);
      return { deal: await moveDeal(s, id, { stageId: String(b.stageId ?? ""), beforeId: typeof b.beforeId === "string" ? b.beforeId : b.beforeId === null ? null : undefined, lostReason: typeof b.lostReason === "string" ? b.lostReason.trim().slice(0, 120) : undefined }) };
    }
    case "DELETE deals :id":
      await deleteDeal(s, id);
      return { ok: true };

    // ─── Activities & tasks ───
    case "GET tasks":
      return tasks(s, { who: qs.who });
    case "POST activities":
      return { activity: await createActivity(s, await body(ctx)) };
    case "PUT activities :id":
      return { activity: await updateActivity(s, id, await body(ctx)) };
    case "DELETE activities :id":
      await deleteActivity(s, id);
      return { ok: true };

    // ─── Sequences ───
    case "GET sequences":
      return { sequences: await listSequences(s) };
    case "POST sequences":
      return { sequence: await saveSequence(s, await body(ctx)) };
    case "GET sequences :id":
      return getSequence(s, id);
    case "PUT sequences :id":
      return { sequence: await saveSequence(s, await body(ctx), id) };
    case "DELETE sequences :id":
      await deleteSequence(s, id);
      return { ok: true };
    case "POST sequences :id enroll": {
      const b = await body(ctx);
      const ids = Array.isArray(b.contactIds) ? b.contactIds.map(String) : b.query ? await contactIdsFor(s, b.query, 2000) : [];
      return enroll(s, id, ids);
    }
    case "POST enrollments :id stop":
      await stopEnrollment(s, id);
      return { ok: true };

    // ─── Reports ───
    case "GET reports":
      return salesReport(s, { from: qs.from, to: qs.to, pipelineId: qs.pipelineId });

    // ─── Setup ───
    case "POST pipelines":
      requireManage(s);
      return { pipeline: await createPipeline(orgId, check(pipelineSchema, await body(ctx))) };
    case "PUT pipelines :id":
      requireManage(s);
      return { pipeline: await updatePipeline(orgId, id, check(pipelineSchema, await body(ctx))) };
    case "DELETE pipelines :id":
      requireManage(s);
      await deletePipeline(orgId, id);
      return { ok: true };
    case "POST fields":
      return { field: await saveField(s, await body(ctx)) };
    case "PUT fields :id":
      return { field: await saveField(s, await body(ctx), id) };
    case "DELETE fields :id":
      await deleteField(s, id);
      return { ok: true };
    case "GET views":
      return { views: await views(s, qs.entity ?? "contact") };
    case "POST views":
      return { view: await saveView(s, await body(ctx)) };
    case "DELETE views :id":
      await deleteView(s, id);
      return { ok: true };
    case "POST sync": {
      requireWrite(s);
      await rateLimit(`crm-sync:${orgId}`, 10, 3600_000);
      return syncAll(orgId);
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
