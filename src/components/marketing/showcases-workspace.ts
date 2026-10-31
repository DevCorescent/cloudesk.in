// Screenshot showcases for the everyday workspace — My work, Calendar and
// Chat. Every image is a real capture of the app (public/marketing/<dir>/),
// taken from a demo business by scripts/marketing/capture-workspace.spec.ts.
import type { Showcase } from "./showcases";
import type { Shot } from "./shot-tour";

const s = (dir: string) => (name: string, alt: string): Shot => ({ src: `/marketing/${dir}/${name}.jpg`, w: 2880, h: 1800, alt });
const ws = s("workspace");
const cal = s("calendar");
const chat = s("chat");
const notes = s("notes");

export const SHOWCASES_WORKSPACE: Record<string, Showcase> = {
  "my-work": {
    hero: { shot: ws("my-work", "My work: an overdue task, today's tasks and CRM follow-ups, with reminders below") },
    note: "Real screenshots from the app, using a demo workspace.",
    chapters: [
      {
        key: "todo",
        eyebrow: "To do",
        title: "Everything waiting on you, in one list.",
        mark: "in one list",
        body: "Approvals, leave and expense claims to decide, timesheets to check, project tasks and CRM follow-ups that are due — gathered from every feature you use, overdue first.",
        bullets: ["Approvals you can decide right there", "Tasks and follow-ups with their due dates", "Overdue work called out in red"],
        tone: "lavender",
        shot: ws("my-work", "My work's to-do list with an overdue task"),
      },
      {
        key: "home",
        eyebrow: "On your dashboard",
        title: "Your day, the moment you sign in.",
        mark: "the moment you sign in",
        body: "Home puts the next meetings (with Join), what needs attention and what's waiting on you at the top — and the sidebar counts unread mail, chats and meeting invites everywhere you go.",
        bullets: ["Up next from your calendar", "Needs attention and waiting on you", "Unread counts on Mail, Calendar and Chat"],
        tone: "sky",
        shot: ws("home", "The home dashboard with Up next meetings, needs attention and waiting on you"),
      },
    ],
  },
  calendar: {
    hero: { shot: cal("week", "The calendar week: meetings with their links, an all-day shoot, an invite found in email and meetings that need minutes") },
    note: "Real screenshots from the app, using a demo workspace.",
    chapters: [
      {
        key: "week",
        eyebrow: "Your week",
        title: "Meetings, from invite to minutes.",
        mark: "from invite to minutes",
        body: "Day, week, month and agenda views. Invites and meeting links in your email wait in the sidebar to add in one click, and meetings that ended are listed until you write the minutes.",
        bullets: ["Google Meet, Zoom and Teams links spotted", "Drag to create, move and resize", "Minutes to write, listed until done"],
        tone: "sky",
        shot: cal("week", "The week view with the From your email and Minutes to write lists"),
      },
      {
        key: "event",
        eyebrow: "Every meeting",
        title: "Join, answer and email the guests.",
        mark: "email the guests",
        body: "Open a meeting for its link, guests, reminders and repeats. Answer an invite and the organiser hears back as a proper calendar reply; email everyone on it in one click.",
        bullets: ["Join button and reminders through the day", "Going, maybe or no — sent to the organiser", "Email guests, or write the minutes"],
        tone: "mint",
        shot: cal("event", "A meeting opened: its link, guests, reminders and Email guests"),
      },
      {
        key: "mail",
        eyebrow: "From your inbox",
        title: "The invite in your email, ready to add.",
        mark: "ready to add",
        body: "A calendar invite in Mail shows as a meeting card with Join, Add to calendar and your answer — and real invites go into your calendar by themselves.",
        bullets: ["Invites read with their time zones", "Updates move it, cancellations cross it out", "Meeting links in plain emails, too"],
        tone: "lavender",
        shot: ws("mail-meeting", "A meeting invite in Mail: the date card, Join, In your calendar and Going? Yes, Maybe, No"),
      },
    ],
  },
  chat: {
    hero: { shot: chat("channel", "A sales channel: a mention, a quotation shared as a card, an approval waiting and a decision people agree to") },
    note: "Real screenshots from the app, using a demo workspace.",
    chapters: [
      {
        key: "channel",
        eyebrow: "Channels",
        title: "Work talk, with the work in it.",
        mark: "with the work in it",
        body: "Channels for teams and topics, direct and group chats. Share an invoice, deal or order from its page as a card, ask for an approval, and settle decisions where they're discussed.",
        bullets: ["Records shared as cards with a link back", "Approvals with a reason when rejected", "Decisions people agree or object to"],
        tone: "lavender",
        shot: chat("channel", "A channel with a quotation card, an approval and a decision"),
      },
      {
        key: "thread",
        eyebrow: "Threads",
        title: "Replies that keep channels readable.",
        mark: "keep channels readable",
        body: "Reply in a thread, with the people in it notified. Mentions are highlighted and gathered in Activity; reactions, pins and saved-for-later keep the important bits close.",
        bullets: ["@mentions, @everyone and #topics", "Saved for later, with a reminder", "Urgent messages that repeat until read"],
        tone: "mint",
        shot: chat("thread", "A thread open beside the channel"),
      },
      {
        key: "interactive",
        eyebrow: "Interactive",
        title: "Polls and checklists, live.",
        mark: "live",
        body: "Run a poll, keep a shared checklist, start a video call or schedule a meeting from the conversation — and let AI catch you up on what you missed when you're back.",
        bullets: ["Polls: anonymous, multiple choice, closing time", "Shared checklists anyone can tick", "AI catch-up with action items"],
        tone: "peach",
        shot: chat("interactive", "A poll with votes and a shared launch-day checklist"),
      },
    ],
  },
  notes: {
    hero: { shot: notes("editor", "A meeting note in Notes: an agenda, a supplier price table and live calculations, with the Elements panel open") },
    note: "Real screenshots from the app, using a demo workspace.",
    chapters: [
      {
        key: "daily",
        eyebrow: "Daily notes",
        title: "Your day, already written in.",
        mark: "already written in",
        body: "Open Today and the note starts with your meetings from Calendar and the tasks due from Projects, as links. Add what matters, then the end-of-day wrap-up — and step back or forward a day.",
        bullets: ["Meetings and tasks filled in for you", "One note per day, made when you open it", "Previous and next day in one click"],
        tone: "butter",
        shot: notes("daily", "Today's daily note with two meetings and a task due"),
      },
      {
        key: "elements",
        eyebrow: "Elements",
        title: "Type “/” for anything.",
        mark: "anything",
        body: "Headings, to-dos, tables, callouts, toggles, code, images, dates, live calculations and records from any module — from the “/” menu, the Elements panel you drag from, or Markdown as you type.",
        bullets: ["Drag blocks to reorder them", "Calculations that update as you type", "Bold, highlight, links and [[note links]]"],
        tone: "lavender",
        shot: notes("slash", "The “/” menu open under the action items"),
      },
      {
        key: "page",
        eyebrow: "On every page",
        title: "Notes right where the work is.",
        mark: "where the work is",
        body: "The notes button in the top bar opens the notes for the page you're on — a customer, an invoice, a deal, any record — and saves a quick note to it, filed in that module's folder.",
        bullets: ["Linked to the page it was written on", "Filed by module automatically", "Markdown to-dos in quick notes"],
        tone: "mint",
        shot: notes("page", "Notes on the CRM page, with a quick note being written"),
      },
      {
        key: "share",
        eyebrow: "Sharing",
        title: "Share it the way you work.",
        mark: "the way you work",
        body: "Keep a note private, let the workspace read or edit it, add chosen people, post it in a chat as a card, email it, or publish a read-only link you can turn off any time.",
        bullets: ["Workspace or chosen people, read or edit", "Into a chat or an email", "A public link, off when you want"],
        tone: "sky",
        shot: notes("share", "The share dialog for a note"),
      },
    ],
  },
};
