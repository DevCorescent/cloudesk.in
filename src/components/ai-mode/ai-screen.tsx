"use client";

// The AI mode screen, shared by visitors (the phone intro) and signed-in
// people (/ai): two round buttons on top, a few suggestion cards and photo
// tiles, the conversation, and a floating composer at the bottom. It only
// draws; whoever uses it decides what the suggestions do and how to answer.
import "./ai-screen.css";
import clsx from "clsx";
import { ArrowUp, Camera, ChevronLeft, FileText, ImagePlus, MessageCirclePlus, Paperclip, Plus, X, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/copilot/markdown";
import { photoUrl } from "@/lib/site/media";

export type AiCard = { id: string; title: string; sub: string; icon: LucideIcon; tone: string; onPick: () => void };
export type AiTile = { id: string; label: string; photo: string | null; onPick: () => void };
export type AiSection = { title: string; label?: string; cards?: AiCard[]; tiles?: AiTile[] };
export type AiMsg = { id: string; role: "user" | "assistant"; text?: string; node?: ReactNode; files?: { name: string; mime?: string }[] };

/** What the + menu accepts: photos and the documents the copilot can read. */
const ACCEPT = "image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md";

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

// The photo editor (crop, scan, PDF) loads when the camera is first used.
const PhotoEditor = dynamic(() => import("./photo-editor").then((m) => m.PhotoEditor), { ssr: false });

/** What the composer takes: free text, an email address, or a password (masked, never shown back). */
export type AiInput = "text" | "email" | "password" | "name";

export function AiScreen(p: { greeting?: string; sections: AiSection[]; messages: AiMsg[]; busy: boolean; /** The "thinking" dots (default: while busy); off once an answer is streaming in. */ typing?: boolean; onSend: (text: string, files: File[]) => void; onClose: () => void; onNew: () => void; closeLabel?: string; placeholder?: string; quick?: string[]; className?: string; input?: AiInput; showHome?: boolean; attach?: boolean; mark?: ReactNode; below?: ReactNode; lead?: ReactNode; moreLabel?: string; overlay?: ReactNode; onSaveDoc?: (file: File) => Promise<string | void> }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const pick = useRef<HTMLInputElement>(null);
  const shoot = useRef<HTMLInputElement>(null);
  // A photo just taken opens in the editor first.
  const [photo, setPhoto] = useState<File | null>(null);
  const takePhoto = (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = "";
    setQuickOpen(false);
    if (f) setPhoto(f);
  };
  const addFiles = (input: HTMLInputElement) => {
    // Copy the list now: clearing the input (so the same file can be picked again) empties it.
    const picked = Array.from(input.files ?? []);
    input.value = "";
    if (picked.length) setFiles((f) => [...f, ...picked].slice(0, 4));
    setQuickOpen(false);
  };
  const [quickOpen, setQuickOpen] = useState(false);
  // Shortcuts: one group at a time, picked from a tab strip, so the first screen fits without scrolling.
  const [tab, setTab] = useState(0);
  // With moreLabel the shortcuts wait behind a toggle, so the opening screen stays clean.
  const [more, setMore] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The bars turn to frosted glass once something scrolls beneath them.
  const [under, setUnder] = useState({ top: false, bottom: false });
  const frame = useRef(0);
  const measure = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const next = { top: el.scrollTop > 4, bottom: el.scrollHeight - el.scrollTop - el.clientHeight > 8 };
      setUnder((u) => (u.top === next.top && u.bottom === next.bottom ? u : next));
    });
  };
  const box = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const chatting = p.showHome === undefined ? p.messages.length > 0 : !p.showHome;
  const kind = p.input ?? "text";
  const single = kind !== "text";
  // A new kind of answer puts the cursor straight in the box.
  useEffect(() => {
    if (chatting && single) field.current?.focus();
  }, [kind, chatting, single]);

  // Follows an answer as it streams in, too.
  const growing = p.messages[p.messages.length - 1]?.text?.length ?? 0;
  useEffect(() => {
    if (chatting) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    measure();
  }, [p.messages.length, p.busy, chatting, growing]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => (ro.disconnect(), cancelAnimationFrame(frame.current));
  }, [chatting]);

  const send = (q = text) => {
    const v = q.trim();
    if ((!v && !files.length) || p.busy) return;
    p.onSend(v, files);
    setFiles([]);
    setText("");
    setQuickOpen(false);
    if (box.current) box.current.style.height = "";
  };

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  return (
    <div className={clsx("ai", p.className)}>
      <header className={clsx("ai-top", under.top && "is-glass")}>
        <div className="ai-top-in">
        <button type="button" className="ai-round" onClick={p.onClose} aria-label={p.closeLabel ?? "Close"}>
          <ChevronLeft className="size-[22px]" strokeWidth={2} />
        </button>
        {p.mark ?? <span className="ai-mark">AI mode</span>}
        <button type="button" className="ai-round" onClick={p.onNew} aria-label="New conversation">
          <MessageCirclePlus className="size-[21px]" strokeWidth={1.9} />
        </button>
        </div>
      </header>

      <div ref={scroller} className="ai-scroll" onScroll={measure}>
        {!chatting ? (
          <div className="ai-home">
            {p.greeting && <p className="ai-greet">{p.greeting}</p>}
            {p.lead}
            {p.moreLabel && p.sections.length > 0 && (
              <button type="button" className={clsx("ai-more", more && "is-open")} aria-expanded={more} onClick={() => setMore(!more)}>
                {p.moreLabel}
                <ChevronLeft className="size-4 -rotate-90" aria-hidden />
              </button>
            )}
            {p.sections.length > 0 && (!p.moreLabel || more) && (
              <section className="ai-sec">
                {p.sections.length > 1 ? (
                  <div className="ai-tabs" role="tablist" aria-label="Shortcuts">
                    {p.sections.map((s, i) => (
                      <button key={s.title} type="button" role="tab" aria-selected={i === tab} className={clsx(i === tab && "is-on")} onClick={() => setTab(i)}>
                        {s.label ?? s.title}
                      </button>
                    ))}
                  </div>
                ) : (
                  <h2 className="ai-h">{p.sections[0]!.title}</h2>
                )}
                {(() => {
                  const s = p.sections[Math.min(tab, p.sections.length - 1)]!;
                  return (
                    <div key={s.title} className="ai-cards" role="tabpanel" aria-label={s.label ?? s.title}>
                      {s.cards?.map((c, i) => {
                        const Icon = c.icon;
                        return (
                          <button key={c.id} type="button" className="ai-card" onClick={c.onPick} style={{ "--tone": c.tone, "--i": i } as CSSProperties}>
                            <span className="ai-obj" aria-hidden>
                              <Icon strokeWidth={1.6} />
                            </span>
                            <span className="ai-card-tx">
                              <b>{c.title}</b>
                              <span>{c.sub}</span>
                            </span>
                          </button>
                        );
                      })}
                      {s.tiles?.map((t, i) => (
                        <button key={t.id} type="button" className="ai-card" onClick={t.onPick} style={{ "--i": i } as CSSProperties}>
                          <span className="ai-obj ai-obj-photo" aria-hidden>
                            {t.photo && <Image src={photoUrl(t.photo, 120, [1, 1])} alt="" fill sizes="40px" className="object-cover" />}
                          </span>
                          <span className="ai-card-tx">
                            <b>{t.label}</b>
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </section>
            )}
          </div>
        ) : (
          <div className="ai-thread" aria-live="polite">
            {p.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ai-msg ai-msg-me">
                  {m.files && m.files.length > 0 && (
                    <span className="ai-msg-files">
                      {m.files.map((f, i) => (
                        <span key={i}>
                          {f.mime?.startsWith("image/") ? <ImagePlus className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
                          {f.name}
                        </span>
                      ))}
                    </span>
                  )}
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="ai-msg ai-msg-ai">
                  {m.text && <Rich text={m.text} />}
                  {m.node}
                </div>
              ),
            )}
            {(p.typing ?? p.busy) && (
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

      <div className={clsx("ai-dock", under.bottom && "is-glass")}>
        {p.below}
        {p.attach && (
          <>
            <input ref={pick} type="file" multiple accept={ACCEPT} hidden onChange={(e) => addFiles(e.target)} />
            <input ref={shoot} type="file" accept="image/*" capture="environment" hidden onChange={(e) => takePhoto(e.target)} />
          </>
        )}
        {quickOpen && p.attach && (
          <div className="ai-attach">
            <button type="button" onClick={() => pick.current?.click()}>
              <Paperclip className="size-[18px]" aria-hidden />
              <span>
                <b>Photo or document</b>
                <small>PDF, Word, Excel, images — bills, contracts, lists</small>
              </span>
            </button>
            <button type="button" onClick={() => shoot.current?.click()}>
              <Camera className="size-[18px]" aria-hidden />
              <span>
                <b>Take a photo or scan</b>
                <small>Crop, clean up, make a PDF — or let AI analyse it</small>
              </span>
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="ai-files">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="ai-file">
                {f.type.startsWith("image/") ? <ImagePlus className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
                <span>{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
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
          className="ai-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button type="button" className="ai-plus" aria-label={p.attach ? "Add a file or a suggestion" : "Suggestions"} aria-expanded={quickOpen} onClick={() => setQuickOpen(!quickOpen)}>
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
            placeholder={p.placeholder ?? "Ask Cloudesk"}
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
          {p.attach && !single && (
            <button type="button" className="ai-mic" onClick={() => shoot.current?.click()} aria-label="Take a photo">
              <Camera className="size-[21px]" strokeWidth={1.8} />
            </button>
          )}
          <button type="submit" className="ai-go" disabled={(!text.trim() && !files.length) || p.busy} aria-label="Send">
            <ArrowUp className="size-5" strokeWidth={2.2} />
          </button>
        </form>
      </div>
      {p.overlay}
      {photo && (
        <PhotoEditor
          file={photo}
          onClose={() => setPhoto(null)}
          onAttach={(fs) => (setFiles((f) => [...f, ...fs].slice(0, 4)), setPhoto(null))}
          onAsk={(fs, prompt) => {
            setPhoto(null);
            const typed = text.trim();
            p.onSend(typed ? `${prompt}\n\n${typed}` : prompt, [...files, ...fs].slice(0, 4));
            setFiles([]);
            setText("");
          }}
          onSaveDoc={p.onSaveDoc}
        />
      )}
    </div>
  );
}
