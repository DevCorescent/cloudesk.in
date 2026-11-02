"use client";

// The AI mode screen, shared by visitors (the phone intro) and signed-in
// people (/ai): two round buttons on top, a few suggestion cards and photo
// tiles, the conversation, and a floating composer at the bottom. It only
// draws; whoever uses it decides what the suggestions do and how to answer.
import "./ai-screen.css";
import clsx from "clsx";
import { ArrowUp, AudioLines, ChevronLeft, MessageCirclePlus, Mic, Plus, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/copilot/markdown";
import { photoUrl } from "@/lib/site/media";

export type AiCard = { id: string; title: string; sub: string; icon: LucideIcon; tone: string; onPick: () => void };
export type AiTile = { id: string; label: string; photo: string | null; onPick: () => void };
export type AiSection = { title: string; cards?: AiCard[]; tiles?: AiTile[] };
export type AiMsg = { id: string; role: "user" | "assistant"; text?: string; node?: ReactNode };

const Spans = ({ parts }: { parts: Inline[] }) => (
  <>
    {parts.map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : x.code ? <code key={i}>{x.text}</code> : <span key={i}>{x.text}</span>))}
  </>
);

/** The answer's light markdown: paragraphs, bold, lists and tables. */
function Rich({ text }: { text: string }) {
  return (
    <div className="ai-rich">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === "p") return <p key={i}><Spans parts={b.inline} /></p>;
        if (b.type === "h") return <p key={i} className="ai-rich-h"><Spans parts={b.inline} /></p>;
        if (b.type !== "table") {
          const L = b.type;
          return <L key={i}>{b.items.map((it, j) => <li key={j}><Spans parts={it} /></li>)}</L>;
        }
        return (
          <div key={i} className="ai-rich-table">
            <table>
              <thead>
                <tr>{b.head.map((h, j) => <th key={j}><Spans parts={h} /></th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Spans parts={c} /></td>)}</tr>)}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

type SpeechLike = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };

/** Dictation where the browser offers it (Chrome, Safari); null elsewhere. */
function speech(): (new () => SpeechLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** What the composer takes: free text, an email address, or a password (masked, never shown back). */
export type AiInput = "text" | "email" | "password" | "name";

export function AiScreen(p: { greeting?: string; sections: AiSection[]; messages: AiMsg[]; busy: boolean; onSend: (text: string) => void; onClose: () => void; onNew: () => void; closeLabel?: string; placeholder?: string; quick?: string[]; className?: string; input?: AiInput; showHome?: boolean }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const rec = useRef<SpeechLike | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const chatting = p.showHome === undefined ? p.messages.length > 0 : !p.showHome;
  const kind = p.input ?? "text";
  const single = kind !== "text";
  // A new kind of answer puts the cursor straight in the box.
  useEffect(() => {
    if (chatting && single) field.current?.focus();
  }, [kind, chatting, single]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's speech support is only known after mount
    setCanSpeak(!!speech());
  }, []);
  useEffect(() => {
    if (chatting) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [p.messages.length, p.busy, chatting]);
  useEffect(() => () => rec.current?.stop(), []);

  const send = (q = text) => {
    const v = q.trim();
    if (!v || p.busy) return;
    p.onSend(v);
    setText("");
    setQuickOpen(false);
    if (box.current) box.current.style.height = "";
  };

  const dictate = () => {
    const S = speech();
    if (!S) return;
    if (listening) return rec.current?.stop();
    const r = new S();
    r.lang = "en-IN";
    r.interimResults = true;
    r.onresult = (e) => setText(Array.from(e.results, (x) => x[0]!.transcript).join(""));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  return (
    <div className={clsx("ai", p.className)}>
      <header className="ai-top">
        <button type="button" className="ai-round" onClick={p.onClose} aria-label={p.closeLabel ?? "Close"}>
          <ChevronLeft className="size-[22px]" strokeWidth={2} />
        </button>
        <span className="ai-mark">AI mode</span>
        <button type="button" className="ai-round" onClick={p.onNew} aria-label="New conversation">
          <MessageCirclePlus className="size-[21px]" strokeWidth={1.9} />
        </button>
      </header>

      <div className="ai-scroll">
        {!chatting ? (
          <div className="ai-home">
            {p.greeting && <p className="ai-greet">{p.greeting}</p>}
            {p.sections.map((s, si) => (
              <section key={s.title} className="ai-sec" style={{ "--s": si } as CSSProperties}>
                <h2 className="ai-h">{s.title}</h2>
                {s.cards && (
                  <div className="ai-cards">
                    {s.cards.map((c, i) => {
                      const Icon = c.icon;
                      return (
                        <button key={c.id} type="button" className="ai-card" onClick={c.onPick} style={{ "--tone": c.tone, "--i": i } as CSSProperties}>
                          <span className="ai-card-tx">
                            <b>{c.title}</b>
                            <span>{c.sub}</span>
                          </span>
                          <span className="ai-obj" aria-hidden>
                            <Icon strokeWidth={2} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {s.tiles && (
                  <div className="ai-tiles">
                    {s.tiles.map((t, i) => (
                      <button key={t.id} type="button" className="ai-tile" onClick={t.onPick} style={{ "--i": i } as CSSProperties}>
                        {t.photo && <Image src={photoUrl(t.photo, 520, [1, 1])} alt="" fill sizes="50vw" className="object-cover" />}
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="ai-thread" aria-live="polite">
            {p.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ai-msg ai-msg-me">
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="ai-msg ai-msg-ai">
                  {m.text && <Rich text={m.text} />}
                  {m.node}
                </div>
              ),
            )}
            {p.busy && (
              <div className="ai-msg ai-msg-ai">
                <span className="ai-typing" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className="ai-dock">
        {quickOpen && p.quick && (
          <div className="ai-quick">
            {p.quick.map((q) => (
              <button key={q} type="button" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          className={clsx("ai-composer", listening && "is-listening")}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button type="button" className="ai-plus" aria-label="Suggestions" aria-expanded={quickOpen} onClick={() => setQuickOpen(!quickOpen)}>
            <Plus className={clsx("size-[22px] transition-transform", quickOpen && "rotate-45")} strokeWidth={1.8} />
          </button>
          {single ? (
            <input
              ref={field}
              type={kind === "password" ? "password" : kind === "email" ? "email" : "text"}
              inputMode={kind === "email" ? "email" : undefined}
              autoComplete={kind === "password" ? "new-password" : kind === "email" ? "email" : kind === "name" ? "name" : "off"}
              autoCapitalize={kind === "name" ? "words" : "none"}
              spellCheck={false}
              value={text}
              maxLength={200}
              placeholder={p.placeholder ?? "Ask Cloudesk"}
              aria-label="Your answer"
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
          <textarea
            ref={box}
            rows={1}
            value={text}
            maxLength={1500}
            placeholder={listening ? "Listening…" : (p.placeholder ?? "Ask Cloudesk")}
            aria-label="Message"
            onChange={(e) => {
              setText(e.target.value);
              grow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          )}
          {canSpeak && !single && text.trim() && (
            <button type="button" className="ai-mic" onClick={dictate} aria-label={listening ? "Stop dictation" : "Dictate"}>
              <Mic className="size-[21px]" strokeWidth={1.8} />
            </button>
          )}
          {text.trim() || !canSpeak || single ? (
            <button type="submit" className="ai-go" disabled={!text.trim() || p.busy} aria-label="Send">
              <ArrowUp className="size-5" strokeWidth={2.2} />
            </button>
          ) : (
            <button type="button" className={clsx("ai-go", listening && "is-on")} onClick={dictate} aria-label={listening ? "Stop dictation" : "Dictate"}>
              <AudioLines className="size-5" strokeWidth={2} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
