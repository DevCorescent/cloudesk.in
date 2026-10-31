// Cloudesk for Horeca: what guests see — the table QR menu and valet pages.
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { servedNow } from "@/lib/horeca/model";
import { qrMenuPage, type QrMenuData } from "@/lib/horeca/qr-page";
import { appUrl } from "../services/mail";
import { nowHHMM, tableByToken } from "./orders";
import { settingsOf } from "./venue";

export async function qrMenuHtml(token: string) {
  const hit = await tableByToken(token);
  if (!hit) return null;
  const { table, venue } = hit;
  const s = settingsOf(venue);
  const [cats, items, groups] = await Promise.all([
    db.select().from(schema.horecaCategories).where(and(eq(schema.horecaCategories.projectId, venue.projectId), eq(schema.horecaCategories.active, true))).orderBy(asc(schema.horecaCategories.sort), asc(schema.horecaCategories.name)),
    db.select().from(schema.horecaItems).where(eq(schema.horecaItems.projectId, venue.projectId)).orderBy(asc(schema.horecaItems.sort), asc(schema.horecaItems.name)),
    db.select().from(schema.horecaModifierGroups).where(eq(schema.horecaModifierGroups.projectId, venue.projectId)),
  ]);
  const now = nowHHMM();
  const data: QrMenuData = {
    venue: { name: venue.name, kind: venue.kind, currency: venue.currency, taxBps: venue.taxBps, serviceChargeBps: venue.serviceChargeBps },
    table: { name: table.name, kind: table.kind },
    settings: s.qr,
    valetLink: s.valet.enabled && s.qr.valetBooking ? appUrl(`/v/book/${venue.token}`) : null,
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      servedNow: servedNow(c.availableFrom, c.availableTo, now),
      window: c.availableFrom && c.availableTo ? `${c.availableFrom}–${c.availableTo}` : "",
      items: items
        .filter((i) => i.categoryId === c.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          price: i.price,
          image: i.image,
          diet: i.diet,
          spice: i.spice,
          tags: i.tags,
          available: i.available,
          prepMinutes: i.prepMinutes,
          groups: groups
            .filter((g) => (i.modifierGroupIds as string[]).includes(g.id))
            .map((g) => ({ id: g.id, name: g.name, min: g.minSelect, max: g.maxSelect, options: g.options as { id: string; name: string; price: number }[] })),
        })),
    })),
  };
  return qrMenuPage(data);
}
