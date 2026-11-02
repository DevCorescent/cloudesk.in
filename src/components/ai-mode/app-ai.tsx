"use client";

// AI mode in the workspace. The recap and "what needs attention" come straight
// from the dashboard's numbers (instant, no AI needed); anything typed goes to
// the copilot, which answers from the workspace's data within the person's
// role. Setup shortcuts lead the screen while the workspace is still new.
import { useQuery } from "@tanstack/react-query";
import { BellRing, ChartColumn, ChevronRight, Contact, Mail, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { api, errorMessage } from "@/lib/client/api";
import { industryById, visibleTo } from "@/lib/workspace/modules";
import { AiScreen, type AiMsg, type AiSection } from "./ai-screen";

type Kpi = { id: string; label: string; value: number; format: "money" | "number" | "hours" | "percent"; sub?: string; change?: number | null; good?: "up" | "down"; href: string };
type Insight = { id: string; tone: "danger" | "warning" | "info" | "success"; title: string; detail: string; href: string };
type Dash = { kpis: Kpi[]; insights: Insight[]; waiting: { counts: { approvals: number; todo: number; overdue: number } } | null };
type Thread = { id: string; items: ({ role: "user" | "assistant"; text: string } | { role: "tool"; label: string })[]; actions: unknown[] };

const money = (p: number) => {
  const r = p / 100;
  const a = Math.abs(r);
  if (a >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const show = (k: Kpi) => (k.format === "money" ? money(k.value) : k.format === "hours" ? `${k.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}h` : k.format === "percent" ? `${k.value}%` : Math.round(k.value).toLocaleString("en-IN"));
const TONE: Record<Insight["tone"], string> = { danger: "#ff6b6b", warning: "#f5a35c", info: "#6cc0ff", success: "#4fd6a0" };

function hello(name: string) {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${name.split(" ")[0]}.`;
}

let n = 0;
const id = () => `a${++n}`;

const Go = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="ai-link">
    <span>{children}</span>
    <ChevronRight className="size-4" aria-hidden />
  </Link>
);

export function AppAiMode() {
  const { user, org } = useSession();
  const router = useRouter();
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<string | null>(null);
  const has = (m: Parameters<typeof visibleTo>[1]) => visibleTo(org, m);
  const copilotOn = has("copilot");

  const dash = useQuery({ queryKey: ["dashboard", org.id], queryFn: () => api<Dash>(`/api/v1/orgs/${org.id}/dashboard`), staleTime: 60_000 });
  const meta = useQuery({ queryKey: ["copilot", org.id, "meta"], queryFn: () => api<{ connected: boolean; canConnect: boolean }>(`/api/v1/orgs/${org.id}/copilot/meta`), enabled: copilotOn, staleTime: 5 * 60_000, retry: false });

  // Full screen on phones: the app bar and the tab dock step aside.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-immersive", "");
    return () => root.removeAttribute("data-immersive");
  }, []);

  const add = (m: Omit<AiMsg, "id">) => setMsgs((x) => [...x, { id: id(), ...m }]);
  const fresh = !!dash.data && dash.data.kpis.every((k) => !k.value);

  const recap = async () => {
    add({ role: "user", text: "Give me today's business recap" });
    setBusy(true);
    const d = dash.data ?? (await api<Dash>(`/api/v1/orgs/${org.id}/dashboard`).catch(() => null));
    setBusy(false);
    if (!d || !d.kpis.length) return add({ role: "assistant", text: "There's nothing to recap yet — numbers appear here as soon as you make your first sale, invoice or hire." });
    add({
      role: "assistant",
      text: "Here's where things stand right now.",
      node: (
        <div className="ai-panel">
          <div className="ai-rows">
            {d.kpis.slice(0, 8).map((k) => (
              <div key={k.id} className="ai-row">
                <span>
                  {k.label}
                  {k.sub && <small> · {k.sub}</small>}
                </span>
                <b>{show(k)}</b>
                {typeof k.change === "number" && k.change !== 0 && <small style={{ color: (k.change > 0) === (k.good !== "down") ? "#4fd6a0" : "#ff6b6b" }}>{k.change > 0 ? "▲" : "▼"} {Math.abs(Math.round(k.change))}%</small>}
              </div>
            ))}
          </div>
          <Link href="/home" className="ai-cta">
            Open the dashboard
          </Link>
        </div>
      ),
    });
  };

  const attention = async () => {
    add({ role: "user", text: "What needs my attention?" });
    setBusy(true);
    const d = dash.data ?? (await api<Dash>(`/api/v1/orgs/${org.id}/dashboard`).catch(() => null));
    setBusy(false);
    const list = d?.insights ?? [];
    const c = d?.waiting?.counts;
    const waiting = c ? [c.approvals && `${c.approvals} approval${c.approvals === 1 ? "" : "s"} waiting`, c.overdue && `${c.overdue} overdue task${c.overdue === 1 ? "" : "s"}`].filter(Boolean) : [];
    if (!list.length && !waiting.length) return add({ role: "assistant", text: "All clear — nothing needs you right now." });
    add({
      role: "assistant",
      text: waiting.length ? `You have ${waiting.join(" and ")}.${list.length ? " Also worth a look:" : ""}` : "Worth a look:",
      node: list.length ? (
        <div className="ai-panel">
          <div className="ai-rows">
            {list.slice(0, 6).map((i) => (
              <Link key={i.id} href={i.href} className="ai-link">
                <i className="ai-dot-tone" style={{ "--c": TONE[i.tone] } as React.CSSProperties} />
                <span>
                  {i.title}
                  <small>{i.detail}</small>
                </span>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ))}
          </div>
        </div>
      ) : undefined,
    });
  };

  const ask = async (text: string) => {
    add({ role: "user", text });
    if (!copilotOn) {
      return add({
        role: "assistant",
        text: "To answer questions in your own words, switch on the **AI copilot**. It reads your workspace's data — only what your role can see — and anything it suggests changing waits for you to confirm.",
        node: <div className="ai-panel"><Go href="/settings/features">Switch on the AI copilot</Go></div>,
      });
    }
    if (meta.data && !meta.data.connected) {
      return add({
        role: "assistant",
        text: meta.data.canConnect ? "Connect an AI provider first — add an Anthropic API key and I can answer from your data." : "AI isn't connected for this workspace yet. Ask an owner to add an AI provider in Settings.",
        node: meta.data.canConnect ? <div className="ai-panel"><Go href="/settings/ai">Connect an AI provider</Go></div> : undefined,
      });
    }
    setBusy(true);
    try {
      const path = thread.current ? `threads/${thread.current}/messages` : "threads";
      const t = await api<Thread>(`/api/v1/orgs/${org.id}/copilot/${path}`, { method: "POST", body: { text } });
      thread.current = t.id;
      // The answer is everything after the last thing they asked.
      const lastAsk = t.items.map((x) => x.role).lastIndexOf("user");
      const answer = t.items.slice(lastAsk + 1).filter((x): x is { role: "assistant"; text: string } => x.role === "assistant").map((x) => x.text).join("\n\n");
      add({
        role: "assistant",
        text: answer || "Done.",
        node: t.actions.length ? <div className="ai-panel"><Go href={`/copilot/${t.id}`}>Review the suggested change</Go></div> : undefined,
      });
    } catch (e) {
      add({ role: "assistant", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const ahead: AiSection = {
    title: "A few ways to stay ahead.",
    cards: [
      { id: "recap", title: "Get today's business recap", sub: "Sales, money owed, stock and team — at a glance.", icon: ChartColumn, tone: "#4f5ef7", onPick: () => void recap() },
      { id: "attention", title: "See what needs my attention", sub: "Overdue invoices, approvals and anything unusual.", icon: BellRing, tone: "#f5a35c", onPick: () => void attention() },
      { id: "ask", title: "Ask about my sales", sub: "This month against last, answered from your own data.", icon: Sparkles, tone: "#8b7bff", onPick: () => void ask("How did sales do this month compared with last month?") },
    ],
  };
  const launch: AiSection = {
    title: "Set up in a few taps.",
    tiles: [
      { id: "store", label: "Launch my online store", photo: industryById("retail")!.photo, onPick: () => router.push("/launch?kind=store") },
      { id: "site", label: "Build my website", photo: industryById("services")!.photo, onPick: () => router.push("/launch?kind=website") },
    ],
  };
  const finish: AiSection = {
    title: fresh ? `Let's get ${org.name} ready.` : "Finish setting up.",
    cards: [
      { id: "team", title: "Invite my team", sub: "Their own sign-ins, with roles that limit what they see.", icon: Users, tone: "#4fb3ff", onPick: () => router.push("/team") },
      ...(has("crm") ? [{ id: "crm", title: "Bring in my customers", sub: "Import contacts from a CSV or Excel file in seconds.", icon: Contact, tone: "#3ccf91", onPick: () => router.push("/crm") }] : []),
      ...(has("mail") ? [{ id: "mail", title: "Connect my email", sub: "Gmail, Outlook or Zoho in one smart inbox.", icon: Mail, tone: "#ff7aa2", onPick: () => router.push("/mail") }] : []),
    ],
  };

  return (
    <AiScreen
      greeting={hello(user.name)}
      sections={fresh ? [finish, launch, ahead] : [ahead, launch, finish]}
      messages={msgs}
      busy={busy}
      onSend={(t) => void ask(t)}
      onClose={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
      onNew={() => {
        thread.current = null;
        setMsgs([]);
      }}
      placeholder="Ask about your business"
      quick={["Who are my top customers?", "Which items are running low?", "How much am I owed?", "How many people are on leave today?"]}
    />
  );
}
