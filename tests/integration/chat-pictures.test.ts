import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import { closeChatBus } from "@/server/chat/bus";
import { call, cookieFrom, resetDb } from "../helpers";

// A group's picture: its admins set one from an image uploaded to it; members see it.
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const T = (method: string, path: string, body?: unknown, who = "meera") => call((chatApi as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/chat/${path}`, params: { orgId, slug: seg(path) } });
const file = async (channelId: string, mime: string, who = "meera") => (await db.insert(schema.teamFiles).values({ orgId, channelId, filename: "x", mime, size: 3, data: Buffer.from("img"), uploadedBy: U[who] }).returning())[0]!.id;
const channel = async (id: string, who = "meera") => (await T("GET", "meta", undefined, who)).json.channels.find((c: { id: string }) => c.id === id);

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["meera", "Meera Iyer", "meera@pics.in"], ["ravi", "Ravi Kumar", "ravi@pics.in"], ["anika", "Anika Bose", "anika@pics.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.meera })).json.organizations[0].id;
  await db.insert(schema.memberships).values([{ orgId, userId: U.ravi!, role: "editor" }, { orgId, userId: U.anika!, role: "editor" }]);
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("group pictures", () => {
  it("lets the group's admins set a picture its members can see, and tells the group", async () => {
    const g = (await T("POST", "groups", { users: [U.ravi, U.anika], name: "Launch crew" })).json.channel.id;
    const pic = await file(g, "image/jpeg");
    // Ravi is a member, not an admin.
    expect((await T("PATCH", `channels/${g}`, { avatarFileId: pic }, "ravi")).status).toBe(403);
    expect((await T("PATCH", `channels/${g}`, { avatarFileId: pic })).status).toBe(200);
    expect((await channel(g, "ravi")).avatar).toBe(pic);
    // Not yet sent in a message, but it's the group's picture: members can load it.
    expect((await T("GET", `files/${pic}`, undefined, "ravi")).status).toBe(200);
    const msgs = (await T("GET", `channels/${g}/messages`)).json.messages as { kind: string; body: string }[];
    expect(msgs.some((m) => m.kind === "system" && /changed the group picture/.test(m.body))).toBe(true);
    // Made an admin, Ravi can change it too — and remove it.
    expect((await T("PATCH", `channels/${g}/members/${U.ravi}`, { role: "admin" })).status).toBe(200);
    expect((await T("PATCH", `channels/${g}`, { avatarFileId: null }, "ravi")).status).toBe(200);
    expect((await channel(g)).avatar).toBeNull();
  });

  it("only takes an image from the same conversation, and never on a direct message", async () => {
    const g = (await T("POST", "groups", { users: [U.ravi], name: "Two of us" })).json.channel.id;
    const other = (await T("POST", "groups", { users: [U.anika], name: "Elsewhere" })).json.channel.id;
    expect((await T("PATCH", `channels/${g}`, { avatarFileId: await file(g, "application/pdf") })).status).toBe(422);
    expect((await T("PATCH", `channels/${g}`, { avatarFileId: await file(other, "image/png") })).status).toBe(404);
    const dm = (await T("POST", `dm/${U.ravi}`)).json.channel.id;
    expect((await T("PATCH", `channels/${dm}`, { avatarFileId: await file(dm, "image/png") })).status).toBe(422);
  });
});
