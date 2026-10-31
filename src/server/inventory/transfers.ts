// Moving stock between locations. A transfer leaves the source when it's sent
// (stock is "in transit" in between) and arrives when the other end receives
// it. Cancelling something in transit puts it back where it came from.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { transferSchema } from "@/lib/inventory/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { requireWarehouseAccess, check, nextNumber, requirePart, requireWrite, type Scope } from "./access";
import { allocate, getWarehouse, move, type Tx } from "./stock";

async function get(orgId: string, id: string) {
  const [t] = await db.select().from(schema.invTransfers).where(and(eq(schema.invTransfers.orgId, orgId), eq(schema.invTransfers.id, id)));
  if (!t) throw notFound("Transfer");
  return t;
}

export async function listTransfers(s: Scope) {
  const rows = await db.select().from(schema.invTransfers).where(eq(schema.invTransfers.orgId, s.orgId)).orderBy(desc(schema.invTransfers.createdAt)).limit(200);
  return rows;
}

export async function createTransfer(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "locations");
  const b = check(transferSchema, raw);
  if (b.fromId === b.toId) throw new ApiError("validation_failed", "Pick two different locations");
  requireWarehouseAccess(s, b.fromId);
  await Promise.all([getWarehouse(s.orgId, b.fromId), getWarehouse(s.orgId, b.toId)]);
  const ids = [...new Set(b.lines.map((l) => l.itemId))];
  const items = await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, ids)));
  if (items.length !== ids.length) throw new ApiError("validation_failed", "Some items aren't in this workspace");
  const number = await nextNumber(s.orgId, "transfer", s.settings.transferPrefix);
  const [t] = await db.insert(schema.invTransfers).values({ ...b, orgId: s.orgId, number, createdBy: s.userId }).returning();
  return t;
}

async function moveLines(tx: Tx, s: Scope, t: typeof schema.invTransfers.$inferSelect, from: "fromId" | "toId", kind: "transfer_out" | "transfer_in", sign: 1 | -1) {
  const wh = await getWarehouse(s.orgId, t[from], tx);
  const items = await tx.select().from(schema.invItems).where(inArray(schema.invItems.id, t.lines.map((l) => l.itemId)));
  // What leaves is decided once (oldest batches first) and the same batches arrive.
  const resolved: { itemId: string; qty: number; batch: string }[] = [];
  for (const l of t.lines) {
    const item = items.find((i) => i.id === l.itemId)!;
    const parts = sign < 0 ? await allocate(tx, item, wh, l.qty, l.batch) : [{ batch: l.batch, qty: l.qty }];
    for (const p of parts) {
      await move(tx, s, { item, warehouse: wh, qty: sign * p.qty, kind, batch: p.batch, refType: "transfer", refId: t.id, refNo: t.number });
      resolved.push({ itemId: l.itemId, qty: p.qty, batch: p.batch });
    }
  }
  return resolved;
}

export async function sendTransfer(s: Scope, id: string) {
  requireWrite(s);
  const t = await get(s.orgId, id);
  if (t.status !== "draft") throw new ApiError("conflict", "This transfer has already left");
  await db.transaction(async (tx) => {
    await claim(tx, s.orgId, id, ["draft"], "in_transit");
    const lines = await moveLines(tx, s, t, "fromId", "transfer_out", -1);
    await tx.update(schema.invTransfers).set({ lines, sentAt: new Date() }).where(eq(schema.invTransfers.id, id));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.transfer_sent", targetType: "inv_transfer", targetId: id, metadata: { number: t.number } });
}

export async function receiveTransfer(s: Scope, id: string) {
  requireWrite(s);
  const t = await get(s.orgId, id);
  if (t.status !== "in_transit") throw new ApiError("conflict", t.status === "draft" ? "Send it first" : `This transfer is ${t.status.replace("_", " ")}`);
  await db.transaction(async (tx) => {
    await claim(tx, s.orgId, id, ["in_transit"], "received");
    await moveLines(tx, s, t, "toId", "transfer_in", 1);
    await tx.update(schema.invTransfers).set({ receivedAt: new Date() }).where(eq(schema.invTransfers.id, id));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.transfer_received", targetType: "inv_transfer", targetId: id, metadata: { number: t.number } });
}

export async function cancelTransfer(s: Scope, id: string) {
  requireWrite(s);
  const t = await get(s.orgId, id);
  if (t.status === "received" || t.status === "cancelled") throw new ApiError("conflict", `This transfer is ${t.status}`);
  await db.transaction(async (tx) => {
    await claim(tx, s.orgId, id, [t.status], "cancelled");
    if (t.status === "in_transit") await moveLines(tx, s, t, "fromId", "transfer_in", 1);
  });
}

/** Moves a transfer on only from the status it was read in, so two requests at once can't both move its stock. */
async function claim(tx: Tx, orgId: string, id: string, from: string[], to: string) {
  const [r] = await tx.update(schema.invTransfers).set({ status: to }).where(and(eq(schema.invTransfers.id, id), eq(schema.invTransfers.orgId, orgId), inArray(schema.invTransfers.status, from))).returning({ id: schema.invTransfers.id });
  if (!r) throw new ApiError("conflict", "This transfer was just changed by someone else — refresh and try again");
}
