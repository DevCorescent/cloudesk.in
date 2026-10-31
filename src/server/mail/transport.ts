// Talking to real mail servers: IMAP (imapflow) to read and file mail, SMTP
// (nodemailer) to send. Everything above this file goes through the
// MailTransport interface, so tests can swap in a fake server — production
// always talks to the account's real servers.
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import type { FailKind } from "@/lib/mail/api";
import { publicAddressOf } from "../net/safe-fetch";

export type Creds = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  /** A password, or an OAuth access token (XOAUTH2). */
  pass?: string;
  accessToken?: string;
};
export type Folder = { path: string; name: string; specialUse?: string };
export type Fetched = { uid: number; flags: string[]; source: Buffer };

export interface MailConn {
  folders(): Promise<Folder[]>;
  /** Mail with a UID above `lastUid` (or, on the first sync, received since `since`), newest `limit` at most. */
  fetchNew(path: string, opts: { lastUid: number; since?: Date; limit: number }): Promise<{ uidValidity: number; messages: Fetched[] }>;
  setFlags(path: string, uids: number[], flags: string[], add: boolean): Promise<void>;
  move(path: string, uids: number[], dest: string): Promise<void>;
  append(path: string, raw: Buffer, flags: string[]): Promise<void>;
  close(): Promise<void>;
}
export interface MailTransport {
  imap(c: Creds): Promise<MailConn>;
  verifySmtp(c: Creds): Promise<void>;
  /** Sends a fully built message; returns nothing — the raw message is built by `compose`. */
  send(c: Creds, envelope: { from: string; to: string[] }, raw: Buffer): Promise<void>;
}

/** A new Message-ID on the sender's domain. */
export const newMessageId = (address: string) => `<${randomUUID()}@${address.split("@")[1] ?? "cloudesk.local"}>`;

/** Builds the raw RFC 5322 message (so the same bytes are sent and filed in Sent). */
export async function compose(opts: Mail.Options & { messageId: string }): Promise<Buffer> {
  return new MailComposer(opts).compile().build();
}

/** Bigger messages are skipped by sync (providers cap mail at 25–35 MB; this bounds memory per batch). */
export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;

const auth = (c: Creds) => (c.accessToken ? { user: c.username, accessToken: c.accessToken } : { user: c.username, pass: c.pass ?? "" });

const real: MailTransport = {
  async imap(c) {
    const client = new ImapFlow({ host: await serverAddress(c.imapHost), servername: sni(c.imapHost), port: c.imapPort, secure: c.imapSecure, auth: auth(c), logger: false, socketTimeout: 90_000, greetingTimeout: 20_000, connectionTimeout: 20_000, disableAutoIdle: true });
    await client.connect();
    return {
      async folders() {
        const list = await client.list();
        return list.map((f) => ({ path: f.path, name: f.name, specialUse: f.specialUse || undefined }));
      },
      async fetchNew(path, { lastUid, since, limit }) {
        const lock = await client.getMailboxLock(path);
        try {
          const box = client.mailbox;
          const uidValidity = box && typeof box === "object" ? Number(box.uidValidity) : 0;
          let uids: number[];
          if (lastUid > 0) {
            const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
            uids = (found || []).filter((u) => u > lastUid);
          } else {
            const found = await client.search(since ? { since } : { all: true }, { uid: true });
            uids = found || [];
          }
          uids = uids.sort((a, b) => a - b).slice(-limit);
          const messages: Fetched[] = [];
          if (uids.length) {
            // Sizes first: a message over MAX_MESSAGE_BYTES is never downloaded or parsed into memory.
            // A batch also stops at MAX_BATCH_BYTES; the rest (later UIDs) come on the next sync.
            const sizes = new Map<number, number>();
            for await (const m of client.fetch(uids.join(","), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0);
            const ok: number[] = [];
            let total = 0;
            for (const u of uids) {
              const size = sizes.get(u) ?? 0;
              if (size > MAX_MESSAGE_BYTES) continue;
              if (ok.length && total + size > MAX_BATCH_BYTES) break;
              total += size;
              ok.push(u);
            }
            uids = ok;
          }
          if (uids.length) {
            for await (const m of client.fetch(uids.join(","), { uid: true, flags: true, source: true }, { uid: true })) {
              if (m.source) messages.push({ uid: m.uid, flags: [...(m.flags ?? [])], source: m.source });
            }
          }
          return { uidValidity, messages };
        } finally {
          lock.release();
        }
      },
      async setFlags(path, uids, flags, add) {
        if (!uids.length) return;
        const lock = await client.getMailboxLock(path);
        try {
          if (add) await client.messageFlagsAdd(uids.join(","), flags, { uid: true });
          else await client.messageFlagsRemove(uids.join(","), flags, { uid: true });
        } finally {
          lock.release();
        }
      },
      async move(path, uids, dest) {
        if (!uids.length) return;
        const lock = await client.getMailboxLock(path);
        try {
          await client.messageMove(uids.join(","), dest, { uid: true });
        } finally {
          lock.release();
        }
      },
      async append(path, raw, flags) {
        await client.append(path, raw, flags);
      },
      async close() {
        await client.logout().catch(() => client.close());
      },
    };
  },
  async verifySmtp(c) {
    const t = nodemailer.createTransport(await smtpOptions(c));
    await t.verify();
    t.close();
  },
  async send(c, envelope, raw) {
    const t = nodemailer.createTransport(await smtpOptions(c));
    try {
      await t.sendMail({ envelope, raw });
    } finally {
      t.close();
    }
  },
};

/**
 * Mail servers are typed in by users, so they must be public: connecting to a
 * private/loopback/metadata address would let anyone probe our network. We
 * connect to the checked IP (TLS still verifies the name). Self-hosters whose
 * mail server is on their own LAN can set ALLOW_PRIVATE_MAIL_HOSTS=on.
 */
const serverAddress = (host: string) => (process.env.ALLOW_PRIVATE_MAIL_HOSTS === "on" ? Promise.resolve(host) : publicAddressOf(host));

const sni = (host: string) => (isIP(host) ? undefined : host);

async function smtpOptions(c: Creds) {
  return {
    host: await serverAddress(c.smtpHost),
    servername: sni(c.smtpHost),
    port: c.smtpPort,
    secure: c.smtpSecure,
    requireTLS: !c.smtpSecure,
    auth: c.accessToken ? { type: "OAuth2" as const, user: c.username, accessToken: c.accessToken } : { user: c.username, pass: c.pass ?? "" },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  };
}

let current: MailTransport = real;
export const transport = () => current;
/** Tests swap in a fake server; production always uses the real one. */
export function setMailTransport(t: MailTransport | null) {
  current = t ?? real;
}

/** Sorts a connection error into what went wrong. */
export function failKind(err: unknown): FailKind {
  const e = err as { message?: string; code?: string; responseText?: string; authenticationFailed?: boolean; response?: string };
  const msg = `${e.responseText ?? ""} ${e.response ?? ""} ${e.message ?? ""}`.trim();
  if (e.authenticationFailed || /auth|credential|password|login|535|534|invalid/i.test(msg)) return "auth";
  if (/ENOTFOUND|EAI_AGAIN/i.test(`${e.code} ${msg}`)) return "dns";
  if (/ETIMEDOUT|timeout|ECONNREFUSED|EHOSTUNREACH/i.test(`${e.code} ${msg}`)) return "network";
  if (/certificate|self.signed|CERT_|wrong version number|ssl/i.test(`${e.code} ${msg}`)) return "tls";
  if (/IMAP.*disabled|not enabled/i.test(msg)) return "disabled";
  return "other";
}

/** Turns a connection error into something a person can act on. */
export function explain(err: unknown, side: "imap" | "smtp"): string {
  const e = err as { message?: string; responseText?: string; response?: string };
  const msg = `${e.responseText ?? ""} ${e.response ?? ""} ${e.message ?? ""}`.trim();
  const name = side === "imap" ? "IMAP" : "SMTP";
  switch (failKind(err)) {
    case "auth": return "The server didn't accept the sign-in. Check the address and password — most providers need an app password here, not your normal one.";
    case "dns": return `Couldn't find the ${name} server. Check the server name under Advanced.`;
    case "network": return `The ${name} server didn't answer on that port. Check the port and SSL setting (IMAP: 993 with SSL; SMTP: 465 with SSL or 587 without).`;
    case "tls": return "The secure connection failed. Try the other SSL setting or port (465 ↔ 587 for SMTP).";
    case "disabled": return "IMAP is switched off for this mailbox. Turn it on in your provider's settings (see the steps).";
    default: return msg ? `The ${name} server said: ${msg.slice(0, 200)}` : `Couldn't connect to the ${name} server.`;
  }
}
