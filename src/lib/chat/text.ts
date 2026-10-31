// Chat message text: light formatting plus tokens for people, records and
// topics. Shared by the server (to notify the right people, index tags) and
// the browser (to draw chips).
//
//   @[Asha Rao](u:<user id>)        a person
//   @everyone / @here                everyone in the conversation
//   #[INV/0042](r:invoices/<id>)     a record from any module (kind/id)
//   #pricing                         a topic tag
//   **bold**  _italic_  ~~strike~~  `code`  ```block```  > quote  - list  1. list

export type Token =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "strike"; children: Token[] }
  | { t: "code"; v: string }
  | { t: "user"; id: string; name: string }
  | { t: "everyone"; v: string }
  | { t: "record"; kind: string; id: string; label: string }
  | { t: "tag"; v: string }
  | { t: "link"; href: string; v: string };

export type Block =
  | { b: "p"; tokens: Token[] }
  | { b: "quote"; tokens: Token[] }
  | { b: "code"; v: string }
  | { b: "ul" | "ol"; items: Token[][] };

const USER = /@\[([^\]\n]{1,80})\]\(u:([0-9a-f-]{36})\)/;
const RECORD = /#\[([^\]\n]{1,120})\]\(r:([a-z0-9_-]{1,40})\/([\w-]{1,80})\)/;
const TAG = /(^|[\s(])#([a-z][\w-]{1,39})\b/i;
const EVERYONE = /(^|[\s(])@(everyone|here|channel)\b/;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/;

/** People, records and topic tags in a message (for notifications and filters). */
export function extract(body: string) {
  const users = new Set<string>();
  const records: { kind: string; id: string; label: string }[] = [];
  const tags = new Set<string>();
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  for (const m of text.matchAll(new RegExp(USER, "g"))) users.add(m[2]!);
  for (const m of text.matchAll(new RegExp(RECORD, "g"))) if (!records.some((r) => r.kind === m[2] && r.id === m[3])) records.push({ kind: m[2]!, id: m[3]!, label: m[1]! });
  for (const m of text.replace(new RegExp(RECORD, "g"), " ").matchAll(new RegExp(TAG, "gi"))) tags.add(m[2]!.toLowerCase());
  return { users: [...users], everyone: EVERYONE.test(text), records, tags: [...tags].slice(0, 20) };
}

/** Plain words, for search, previews and notifications: tokens become their names. */
export function plain(body: string) {
  return body
    .replace(new RegExp(USER, "g"), "@$1")
    .replace(new RegExp(RECORD, "g"), "$1")
    .replace(/```(\w+\n)?/g, "")
    .replace(/(\*\*|~~|`)/g, "")
    .replace(/(^|\s)_(\S[^_\n]*?)_(?=\s|$|[.,!?])/g, "$1$2")
    .replace(/^> ?/gm, "")
    .trim();
}

export function preview(body: string, n = 140) {
  const p = plain(body).replace(/\s+/g, " ");
  return p.length > n ? `${p.slice(0, n - 1)}…` : p;
}

function inline(s: string): Token[] {
  const out: Token[] = [];
  let rest = s;
  const rules: { re: RegExp; make: (m: RegExpExecArray) => Token[] }[] = [
    { re: /`([^`\n]+)`/, make: (m) => [{ t: "code", v: m[1]! }] },
    { re: USER, make: (m) => [{ t: "user", name: m[1]!, id: m[2]! }] },
    { re: RECORD, make: (m) => [{ t: "record", label: m[1]!, kind: m[2]!, id: m[3]! }] },
    { re: /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/, make: (m) => [{ t: "link", v: m[1]!, href: m[2]! }] },
    { re: URL_RE, make: (m) => [{ t: "link", v: m[0], href: m[0] }] },
    { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/, make: (m) => [{ t: "bold", children: inline(m[1]!) }] },
    { re: /~~(?=\S)([\s\S]*?\S)~~/, make: (m) => [{ t: "strike", children: inline(m[1]!) }] },
    { re: /(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,!?)])/, make: (m) => [...(m[1] ? [{ t: "text", v: m[1] } as Token] : []), { t: "italic", children: inline(m[2]!) }] },
    { re: EVERYONE, make: (m) => [...(m[1] ? [{ t: "text", v: m[1] } as Token] : []), { t: "everyone", v: `@${m[2]}` }] },
    { re: TAG, make: (m) => [...(m[1] ? [{ t: "text", v: m[1] } as Token] : []), { t: "tag", v: m[2]!.toLowerCase() }] },
  ];
  while (rest) {
    let best: { i: number; m: RegExpExecArray; r: (typeof rules)[number] } | null = null;
    for (const r of rules) {
      const m = r.re.exec(rest);
      if (m && (!best || m.index < best.i)) best = { i: m.index, m, r };
    }
    if (!best) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (best.i > 0) out.push({ t: "text", v: rest.slice(0, best.i) });
    out.push(...best.r.make(best.m));
    rest = rest.slice(best.i + best.m[0].length);
  }
  return out;
}

/** The message as blocks of tokens, for drawing. Never HTML — the UI builds elements. */
export function parse(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ b: "p", tokens: inline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      blocks.push({ b: "code", v: code.join("\n") });
    } else if (/^> ?/.test(l)) {
      flush();
      const q: string[] = [l.replace(/^> ?/, "")];
      while (i + 1 < lines.length && /^> ?/.test(lines[i + 1]!)) q.push(lines[++i]!.replace(/^> ?/, ""));
      blocks.push({ b: "quote", tokens: inline(q.join("\n")) });
    } else if (/^\s*[-*•] /.test(l) || /^\s*\d+[.)] /.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)] /.test(l);
      const re = ordered ? /^\s*\d+[.)] / : /^\s*[-*•] /;
      const items: Token[][] = [inline(l.replace(re, ""))];
      while (i + 1 < lines.length && re.test(lines[i + 1]!)) items.push(inline(lines[++i]!.replace(re, "")));
      blocks.push({ b: ordered ? "ol" : "ul", items });
    } else if (!l.trim()) flush();
    else para.push(l);
  }
  flush();
  return blocks;
}

/** Only emoji, and few of them: shown large. */
export const bigEmoji = (body: string) => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u.test(body.trim()) && /\p{Extended_Pictographic}/u.test(body) && [...body.trim().matchAll(/\p{Extended_Pictographic}/gu)].length <= 3;

export const userToken = (id: string, name: string) => `@[${name.replace(/[\]\n]/g, "")}](u:${id})`;
export const recordToken = (kind: string, id: string, label: string) => `#[${label.replace(/[\]\n]/g, "")}](r:${kind}/${id})`;
