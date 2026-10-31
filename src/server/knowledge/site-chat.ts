import { readCookie } from "../auth/session";
import { renderShell, type RenderMode } from "@/lib/site/render";
import type { SiteDoc } from "@/lib/site/model";
import { CHAT_CSS, chatLauncher, chatPage } from "@/lib/site/chat-page";
import { STORE_FORMS } from "@/lib/store/storefront";
import { chatCookieName, conversationFor, getChatbot, launcherFor, messagesOf } from "./chat";

/** The /chat page of a published site, or null when the chatbot is off. */
export async function renderChatPage(req: Request, projectId: string, doc: SiteDoc, base: string, mode: RenderMode) {
  const bot = await getChatbot(projectId);
  if (!bot.enabled) return null;
  const url = new URL(req.url);
  const { conversation } = await conversationFor(projectId, readCookie(req.headers.get("cookie"), chatCookieName(projectId)), false);
  const messages = conversation ? (await messagesOf(conversation.id)).map((m) => ({ role: m.role, text: m.text, sources: (m.sources as { title: string; url: string | null }[]) ?? [] })) : [];
  const main = `<style>${CHAT_CSS}</style>${chatPage({ base, formBase: STORE_FORMS(projectId), name: bot.name, greeting: bot.greeting, messages, handoff: true, sent: url.searchParams.get("sent") === "1", error: url.searchParams.get("err") ?? undefined })}`;
  return renderShell(doc, mode, { title: `Chat with ${bot.name}`, main, noindex: true });
}

/** Adds the floating chat button to a published page when the owner turned it on. */
export async function withChatLauncher(html: string, projectId: string, base: string, path: string) {
  if (path === "/chat" || !html.includes("</body>")) return html;
  const l = await launcherFor(projectId);
  return l.on ? html.replace("</body>", `${chatLauncher(base, l.name)}</body>`) : html;
}
