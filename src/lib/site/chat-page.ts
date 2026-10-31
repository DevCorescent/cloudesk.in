// The published site's chat page and floating launcher. No JavaScript: the
// conversation is a server-rendered page and each message is a form post.
import { esc } from "./html";

export type ChatPageMessage = { role: string; text: string; sources: { title: string; url: string | null }[] };

const linkFor = (base: string, url: string) => (/^https?:\/\//.test(url) ? url : `${base}${url}`);

export function chatPage(c: { base: string; formBase: string; name: string; greeting: string; messages: ChatPageMessage[]; handoff: boolean; sent: boolean; error?: string }) {
  const bubbles = [{ role: "assistant", text: c.greeting, sources: [] as ChatPageMessage["sources"] }, ...c.messages]
    .map(
      (m, i, all) =>
        `<li class="cc-msg cc-${m.role === "user" ? "me" : "bot"}"${i === all.length - 1 ? ' id="latest"' : ""}><div class="cc-bubble">${esc(m.text).replace(/\n/g, "<br>")}${
          m.sources.length ? `<span class="cc-src">${m.sources.map((s) => (s.url ? `<a href="${esc(linkFor(c.base, s.url))}">${esc(s.title)}</a>` : esc(s.title))).join(" · ")}</span>` : ""
        }</div></li>`,
    )
    .join("");
  return `<section class="sec py-sm cc-chat"><div class="wrap narrow">
<header class="cc-head"><span class="cc-avatar" aria-hidden="true">${esc(c.name.slice(0, 1).toUpperCase())}</span><div><h1>${esc(c.name)}</h1><p class="muted">Answers come from this website. For anything else, ask for a person.</p></div></header>
${c.error ? `<p class="cc-error" role="alert">${esc(c.error)}</p>` : ""}${c.sent ? `<p class="cc-ok" role="status">Thanks — the team will reply by email.</p>` : ""}
<ol class="cc-thread" aria-live="polite">${bubbles}</ol>
<form class="cc-form" method="post" action="${esc(c.formBase)}/chat"><input type="hidden" name="_base" value="${esc(c.base)}"><input type="hidden" name="action" value="ask"><label class="sr-only" for="cc-q">Your question</label><input id="cc-q" name="message" required maxlength="1000" autocomplete="off" placeholder="Ask a question…" autofocus><button class="btn btn-primary" type="submit">Send</button></form>
${c.handoff ? `<details class="cc-human"><summary>Talk to a person</summary><form method="post" action="${esc(c.formBase)}/chat"><input type="hidden" name="_base" value="${esc(c.base)}"><input type="hidden" name="action" value="handoff"><label>Your email<input type="email" name="email" required maxlength="200" autocomplete="email"></label><label>Anything to add? (optional)<textarea name="note" rows="2" maxlength="1000"></textarea></label><button class="btn btn-secondary" type="submit">Ask the team to reply</button></form></details>` : ""}
</div></section>`;
}

export const CHAT_CSS = `.cc-chat .cc-head{display:flex;gap:14px;align-items:center;margin-bottom:22px}.cc-chat .cc-head h1{font-size:1.5rem;margin:0}.cc-chat .cc-head p{margin:0;font-size:.9rem}
.cc-avatar{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--accent-text);font-weight:600}
.cc-thread{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:10px}.cc-msg{display:flex}.cc-me{justify-content:flex-end}
.cc-bubble{max-width:80%;padding:10px 14px;border-radius:18px;line-height:1.5;font-size:.95rem}.cc-bot .cc-bubble{background:var(--surface);border:1px solid var(--line);border-bottom-left-radius:6px}.cc-me .cc-bubble{background:var(--accent);color:var(--accent-text);border-bottom-right-radius:6px}
.cc-src{display:block;margin-top:6px;font-size:.78rem;opacity:.8}.cc-src a{color:inherit}
.cc-form{display:flex;gap:8px;position:sticky;bottom:12px}.cc-form input{flex:1;font:inherit;padding:12px 16px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
.cc-human{margin-top:16px;font-size:.9rem}.cc-human summary{cursor:pointer;color:var(--muted)}.cc-human form{display:grid;gap:10px;margin-top:10px}.cc-human input,.cc-human textarea{width:100%;font:inherit;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
.cc-error{color:#b42318}.cc-ok{color:#1e7d34}`;

/** A floating "Chat with us" button added to published pages (pure HTML/CSS). */
export function chatLauncher(base: string, name: string) {
  return `<style>.cc-launch{position:fixed;right:20px;bottom:20px;z-index:60;display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;background:var(--text,#111);color:var(--bg,#fff);font:600 14px/1 var(--font,system-ui);text-decoration:none;box-shadow:0 10px 30px -10px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.15);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}.cc-launch:hover{transform:translateY(-1px)}@media print{.cc-launch{display:none}}</style><a class="cc-launch" href="${esc(base)}/chat" aria-label="Chat with ${esc(name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Chat with us</a>`;
}
