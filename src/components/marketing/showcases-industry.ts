// Screenshot showcases for the marketing, helpdesk, custom objects,
// compliance, copilot, clinic, construction and education feature pages.
// Every image is a real capture of the app (public/marketing/<feature>/),
// taken by scripts/marketing/capture-industry.spec.ts from demo workspaces;
// hotspot positions are percentages of the image.
import type { Shot } from "./shot-tour";
import type { Showcase } from "./showcases";

const shotOf = (dir: string) => (name: string, alt: string): Shot => ({ src: `/marketing/${dir}/${name}.jpg`, w: 2880, h: 1800, alt });
const mkt = shotOf("marketing");
const hd = shotOf("helpdesk");
const obj = shotOf("custom-objects");
const grc = shotOf("compliance");
const cop = shotOf("copilot");
const cli = shotOf("clinic");
const con = shotOf("construction");
const edu = shotOf("education");
/** A cropped close-up (one card or document), shown whole. */
const crop = (dir: string, name: string, w: number, h: number, alt: string): Shot => ({ src: `/marketing/${dir}/${name}.jpg`, w, h, alt });

const NOTE = "Real screenshots from the app, using a demo workspace.";

export const SHOWCASES_INDUSTRY: Record<string, Showcase> = {
  marketing: {
    hero: {
      shot: mkt("home", "Marketing home: campaigns, money spent, won deals the campaigns touched and upcoming events"),
      stack: [
        { label: "Home", shot: mkt("home", "Marketing home: campaigns, money spent, won deals the campaigns touched and upcoming events") },
        { label: "Campaigns", shot: mkt("campaigns", "Every campaign with what it reached, clicks and won deals") },
        { label: "An email", shot: mkt("campaign", "The Diwali email: people reached, clicks, spend and the won deals it touched") },
        { label: "Segments", shot: mkt("segments", "Segments built from CRM tags, with how many can be emailed") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "campaigns",
        eyebrow: "Campaigns",
        title: "Every campaign, and what it earned.",
        mark: "what it earned",
        body: "Emails, events, ads and anything else you spend on sit in one list. Each one shows who it reached, who clicked and the won deals it touched — so you can see what's worth doing again.",
        bullets: ["Email, event, ads or other", "Budget and spend on each", "Won deals linked back to the campaign", "Export the list any time"],
        tone: "peach",
        shot: mkt("campaigns", "Every campaign with what it reached, clicks and won deals"),
        hotspots: [
          { x: 43.6, y: 21.6, label: "Email, events, ads" },
          { x: 50, y: 61.7, label: "Won deals it touched" },
        ],
      },
      {
        key: "email",
        eyebrow: "Email",
        title: "Send to the right people, then see what landed.",
        mark: "see what landed",
        body: "Pick a segment, write a plain-text email and try two subject lines. Links are tracked, an unsubscribe line is added for you, and the results show clicks and the deals that followed.",
        bullets: ["Two subject lines to compare", "{{first_name}} and company filled in", "Tracked links, honest numbers — opens aren't guessed", "Return on spend from won deals"],
        tone: "lavender",
        shot: mkt("campaign", "The Diwali email: people reached, clicks, spend and the won deals it touched"),
        hotspots: [
          { x: 38.8, y: 55, label: "A second subject line" },
          { x: 90.5, y: 47, label: "Clicks per subject" },
          { x: 88.5, y: 29, label: "Won deals and return" },
        ],
      },
      {
        key: "events",
        eyebrow: "Events",
        title: "Events with a sign-up page that fills itself.",
        mark: "fills itself",
        body: "Create a workshop or webinar and share its registration page. Sign-ups arrive with consent recorded, places are counted, and you check people in at the door.",
        bullets: ["A public registration page per event", "Places left, closed when full", "Check-in on the day", "Export the guest list"],
        tone: "mint",
        shot: crop("marketing", "event", 1090, 800, "Registrations for the home styling workshop, six of forty places, each with Check in"),
        panel: true,
        hotspots: [
          { x: 28, y: 11, label: "Places taken" },
          { x: 87.7, y: 23, label: "Check in at the door" },
        ],
      },
      {
        key: "segments",
        eyebrow: "Segments",
        title: "Groups that keep themselves up to date.",
        mark: "keep themselves up to date",
        body: "A segment is a rule over your CRM contacts — like everyone tagged VIP — worked out fresh each time you send. Only people who agreed to marketing email are counted as reachable.",
        bullets: ["Built from CRM tags and details", "Fresh at the moment of sending", "Consent respected automatically"],
        tone: "sky",
        shot: mkt("segments", "Segments built from CRM tags, with how many can be emailed"),
        hotspots: [
          { x: 38.5, y: 28.4, label: "The rule" },
          { x: 93.7, y: 28.4, label: "Only people who said yes" },
        ],
      },
    ],
  },

  helpdesk: {
    hero: {
      shot: hd("inbox", "The ticket list: open tickets with priority, assignee and when the next reply is due"),
      stack: [
        { label: "Tickets", shot: hd("inbox", "The ticket list: open tickets with priority, assignee and when the next reply is due") },
        { label: "A ticket", shot: hd("ticket", "A ticket with the customer's message, an internal note and the reply") },
        { label: "Reports", shot: hd("reports", "Helpdesk reports: replies and resolutions on time, and satisfaction") },
        { label: "Saved replies", shot: hd("canned", "Saved replies with name and ticket placeholders") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "tickets",
        eyebrow: "One inbox",
        title: "Phone, email and web — one list.",
        mark: "one list",
        body: "Tickets arrive by email, from the support form on your website, or logged by the team after a call. The oldest due comes first, and response targets count business hours only.",
        bullets: ["Mine, unassigned, waiting and missed-target views", "Assign in turn across the team", "Targets pause while you wait on the customer", "Import from another helpdesk"],
        tone: "rose",
        shot: hd("inbox", "The ticket list: open tickets with priority, assignee and when the next reply is due"),
        hotspots: [
          { x: 38, y: 21.6, label: "Views for every situation" },
          { x: 71.6, y: 32.3, label: "Priority" },
          { x: 93.6, y: 32.3, label: "Due in business hours" },
        ],
      },
      {
        key: "ticket",
        eyebrow: "Replying",
        title: "Answer fast, keep notes private.",
        mark: "keep notes private",
        body: "Reply to the customer by email or leave an internal note for the team — notes never reach the customer. Saved replies fill in the name and ticket number for you.",
        bullets: ["Internal notes stay inside", "Saved replies with placeholders", "Every status change on the timeline", "Customer details and a link to the CRM"],
        tone: "sky",
        shot: hd("ticket", "A ticket with the customer's message, an internal note and the reply"),
        hotspots: [
          { x: 55, y: 37.6, label: "Internal note" },
          { x: 68.8, y: 64.4, label: "Saved replies" },
          { x: 80, y: 37.4, label: "Targets" },
        ],
      },
      {
        key: "reports",
        eyebrow: "Reports",
        title: "Know you're keeping your promises.",
        mark: "keeping your promises",
        body: "See how many replies and resolutions met their targets, by agent and by channel. Customers rate resolved tickets on their own link, and the score shows here.",
        bullets: ["First reply and resolution on time", "Per agent", "By channel", "Satisfaction from customer ratings"],
        tone: "mint",
        shot: hd("reports", "Helpdesk reports: replies and resolutions on time, and satisfaction"),
        hotspots: [
          { x: 59.3, y: 23, label: "On time" },
          { x: 82.7, y: 32.6, label: "Rated by customers" },
        ],
      },
    ],
  },

  "custom-objects": {
    hero: {
      shot: obj("records", "Showroom visits, a custom object, with client, date, linked product, budget and stage"),
      stack: [
        { label: "Records", shot: obj("records", "Showroom visits, a custom object, with client, date, linked product, budget and stage") },
        { label: "Objects", shot: obj("objects", "Two custom objects: showroom visits and warranty claims") },
        { label: "Fields", shot: obj("fields", "Your own fields on inventory items: number, list, yes/no and link") },
        { label: "Rules", shot: obj("rules", "A rule that stops an order being saved without a visit date") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "objects",
        eyebrow: "Your own records",
        title: "Track the things only your business has.",
        mark: "only your business has",
        body: "Make a new kind of record — showroom visits, warranty claims, licences, samples — with exactly the fields you need. Each gets its own list, numbering, search, import and export.",
        bullets: ["Text, numbers, dates, lists, yes/no, web links", "Link to real items, contacts and more", "Numbered automatically", "Import and export as CSV or Excel"],
        tone: "lavender",
        shot: obj("records", "Showroom visits, a custom object, with client, date, linked product, budget and stage"),
        hotspots: [
          { x: 40.5, y: 41.6, label: "Numbered for you" },
          { x: 69.9, y: 40.6, label: "Linked to real products" },
          { x: 49.9, y: 25.4, label: "Import and export" },
        ],
      },
      {
        key: "fields",
        eyebrow: "Built-in records too",
        title: "Add your fields to what's already there.",
        mark: "what's already there",
        body: "Items, employees, tickets and other built-in records take your own fields as well. They show on the record's page, alongside everything that links back to it.",
        bullets: ["Reorder, edit or remove fields", "Bulk changes with undo", "Values checked as they're saved"],
        tone: "butter",
        shot: obj("fields", "Your own fields on inventory items: number, list, yes/no and link"),
        hotspots: [
          { x: 45.6, y: 28.6, label: "Add a field" },
          { x: 62.5, y: 41.9, label: "A list of choices" },
        ],
      },
      {
        key: "linked",
        eyebrow: "Connected",
        title: "Everything links back.",
        mark: "links back",
        body: "Link a custom record to a product and the product shows it too — here, the warranty claim and showroom visits for one lamp, next to the fields you added.",
        bullets: ["Your fields on the built-in page", "Linked records listed automatically", "One click between them"],
        tone: "mint",
        shot: crop("custom-objects", "item", 1880, 776, "An inventory item with its custom fields and the visits and claims linked to it"),
        panel: true,
        hotspots: [
          { x: 12, y: 40, label: "Your fields" },
          { x: 16, y: 85, label: "Linked from your records" },
        ],
      },
      {
        key: "rules",
        eyebrow: "Rules",
        title: "Rules that stop mistakes before they're saved.",
        mark: "before they're saved",
        body: "Say what must be true — an order needs a visit date, furniture needs a warranty — and a save that breaks it is stopped with your message. Rules apply to edits, bulk changes and imports.",
        bullets: ["When this, then that must be true", "Your own message", "Checked on edits, bulk changes and imports"],
        tone: "rose",
        shot: obj("rules", "A rule that stops an order being saved without a visit date"),
        hotspots: [{ x: 45.7, y: 33.6, label: "Your rule, in plain words" }],
      },
    ],
  },

  compliance: {
    hero: {
      shot: grc("home", "Compliance overview: filings due, incidents, audit findings and the risk heat map"),
      stack: [
        { label: "Overview", shot: grc("home", "Compliance overview: filings due, incidents, audit findings and the risk heat map") },
        { label: "Risks", shot: grc("risks", "The risk register with inherent and residual scores") },
        { label: "Calendar", shot: grc("calendar", "The compliance calendar with GST, TDS, PF, ESI and ROC due dates") },
        { label: "Controls", shot: grc("controls", "Controls with their last test result and next test date") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "overview",
        eyebrow: "At a glance",
        title: "Your risk and compliance, on one screen.",
        mark: "on one screen",
        body: "Filings due this week, open incidents, overdue control tests and audit findings — with a heat map of where your risks stand once their controls are counted.",
        bullets: ["Policies waiting for you to read", "Risk heat map, likelihood × impact", "Everything overdue in red"],
        tone: "lavender",
        shot: grc("home", "Compliance overview: filings due, incidents, audit findings and the risk heat map"),
        hotspots: [
          { x: 45, y: 19.6, label: "Policies to acknowledge" },
          { x: 50.9, y: 31.6, label: "Filings due this week" },
          { x: 43.7, y: 55.2, label: "Risk heat map" },
        ],
      },
      {
        key: "calendar",
        eyebrow: "Filings",
        title: "Every Indian filing date, already in.",
        mark: "already in",
        body: "Add the Indian pack and GST returns, TDS, PF, ESI, ROC filings and advance tax land on the calendar with their due dates. Owners are reminded before each one, and again if it's overdue.",
        bullets: ["One click to add the common filings", "Your own obligations too", "Mark done with the reference number", "Reminders before and after"],
        tone: "butter",
        shot: grc("calendar", "The compliance calendar with GST, TDS, PF, ESI and ROC due dates"),
        hotspots: [
          { x: 42.2, y: 52.5, label: "GST, TDS, PF, ROC" },
          { x: 95, y: 28.2, label: "Mark it done" },
        ],
      },
      {
        key: "risks",
        eyebrow: "Risks",
        title: "Risks before and after your controls.",
        mark: "before and after",
        body: "Score each risk for likelihood and impact, link the controls that reduce it, and see what's left. Import an existing register from a spreadsheet.",
        bullets: ["Inherent and residual scores", "Owner and review date", "Import from Excel or CSV"],
        tone: "rose",
        shot: grc("risks", "The risk register with inherent and residual scores"),
        hotspots: [
          { x: 72.5, y: 30.4, label: "After controls" },
          { x: 82.2, y: 13.6, label: "Import your register" },
        ],
      },
      {
        key: "controls",
        eyebrow: "Controls",
        title: "Controls that are actually tested.",
        mark: "actually tested",
        body: "Record each test with what was sampled and whether the control worked. The last result and the next due test show at a glance — alongside policies, incidents and internal audits.",
        bullets: ["Effective or not, with notes", "Next test date from the frequency", "Policies with read receipts, incidents and audits"],
        tone: "mint",
        shot: grc("controls", "Controls with their last test result and next test date"),
        hotspots: [
          { x: 85.8, y: 39.8, label: "Last test result" },
          { x: 93, y: 33.4, label: "Next test due" },
        ],
      },
    ],
  },

  copilot: {
    hero: {
      shot: cop("checks", "Copilot checks: a possible duplicate supplier bill and an expense account running high"),
      stack: [
        { label: "Checks", shot: cop("checks", "Copilot checks: a possible duplicate supplier bill and an expense account running high") },
        { label: "Ask", shot: cop("ask", "Ask the copilot, with suggested questions and the prompt to connect an AI provider") },
      ],
    },
    note: "Real screenshots from the app, using a demo workspace. Checks run on fixed rules; asking questions needs your own AI provider key.",
    chapters: [
      {
        key: "checks",
        eyebrow: "Checks",
        title: "A second pair of eyes on your books.",
        mark: "second pair of eyes",
        body: "Fixed rules look for the same supplier bill entered twice, bills far above a supplier's usual, and expense accounts well ahead of recent months. A finding is worth a look, not proof of a mistake.",
        bullets: ["Duplicate supplier bills", "Unusually large bills", "Spending spikes against recent months", "No AI needed for checks"],
        tone: "peach",
        shot: cop("checks", "Copilot checks: a possible duplicate supplier bill and an expense account running high"),
        hotspots: [
          { x: 64.2, y: 24.8, label: "Same bill twice" },
          { x: 54, y: 31.8, label: "Spending running high" },
        ],
      },
      {
        key: "ask",
        eyebrow: "Ask",
        title: "Questions in plain words, answers from your data.",
        mark: "answers from your data",
        body: "Ask who owes you the most or how this month compares with the last. Answers come from your workspace's own data, limited to what your role can see.",
        bullets: ["Suggested questions to start", "Only what your role may see", "Conversations kept for later"],
        tone: "lavender",
        shot: cop("ask", "Ask the copilot, with suggested questions and the prompt to connect an AI provider"),
        hotspots: [{ x: 50.9, y: 32.3, label: "Ask in plain words" }],
      },
      {
        key: "confirm",
        eyebrow: "In your control",
        title: "Nothing changes until you say so.",
        mark: "until you say so",
        body: "The copilot uses Claude through your workspace's own Anthropic API key. Anything it suggests changing — a task, a follow-up — waits for you to confirm, and owners can see every AI call and its cost.",
        bullets: ["Your own API key", "Suggested changes need a click to confirm", "AI activity and cost for owners"],
        tone: "sky",
        shot: cop("ask", "Ask the copilot, with suggested questions and the prompt to connect an AI provider"),
        hotspots: [{ x: 92.1, y: 24.2, label: "Connect your provider" }],
      },
    ],
  },

  clinic: {
    hero: {
      shot: cli("queue", "Today at the clinic: tokens, who's waiting, who's with the doctor, and money still to collect"),
      stack: [
        { label: "Today", shot: cli("queue", "Today at the clinic: tokens, who's waiting, who's with the doctor, and money still to collect") },
        { label: "Patient", shot: cli("patient", "A patient's page: allergy alert, a signed consultation, the bill and appointments") },
        { label: "Patients", shot: cli("patients", "The patient list with MRN numbers and phone") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "queue",
        eyebrow: "Today",
        title: "The whole day's queue, at a glance.",
        mark: "at a glance",
        body: "Book appointments, give tokens, and move each patient from waiting to with the doctor to done. The day's billing and what's still to collect sit right above.",
        bullets: ["Token numbers per doctor", "Arrived, waiting, with doctor, done", "No-shows marked in one tap", "Billed today and still to collect"],
        tone: "rose",
        shot: cli("queue", "Today at the clinic: tokens, who's waiting, who's with the doctor, and money still to collect"),
        hotspots: [
          { x: 37.5, y: 32.6, label: "Tokens" },
          { x: 95.2, y: 51.5, label: "Call the next patient" },
          { x: 82.5, y: 19.8, label: "Billed and to collect" },
        ],
      },
      {
        key: "patient",
        eyebrow: "Consultations",
        title: "Vitals, diagnosis and prescription — signed.",
        mark: "signed",
        body: "Record vitals, complaints, diagnosis and the prescription, then sign. A signed consultation can't be edited — only added to — and allergies stay at the top of every visit.",
        bullets: ["Allergy alerts up front", "Vitals flagged when out of range", "Signed notes locked, with addenda", "Bills and payments on the same page"],
        tone: "sky",
        shot: cli("patient", "A patient's page: allergy alert, a signed consultation, the bill and appointments"),
        hotspots: [
          { x: 40.3, y: 26.2, label: "Allergies up front" },
          { x: 40.7, y: 39.5, label: "Vitals flagged" },
          { x: 88.7, y: 36.6, label: "Signed and locked" },
        ],
      },
      {
        key: "prescription",
        eyebrow: "Prescriptions",
        title: "A clean prescription to print or share.",
        mark: "print or share",
        body: "Every signed consultation has a printable prescription with the clinic, doctor, diagnosis, each medicine's dose and days, and the follow-up date.",
        bullets: ["Medicine, dose and days", "Follow-up date", "Clinic and doctor on top"],
        tone: "mint",
        shot: crop("clinic", "prescription", 1240, 680, "A printable prescription for a dental patient"),
        panel: true,
        hotspots: [
          { x: 86.8, y: 17.5, label: "Print" },
          { x: 40.5, y: 65.5, label: "Dose and days" },
        ],
      },
      {
        key: "patients",
        eyebrow: "Records",
        title: "Every patient, one search away.",
        mark: "one search away",
        body: "Each patient gets a record number. Find anyone by name, number or phone, with consent recorded when they register.",
        bullets: ["Medical record numbers", "Search by name, MRN or phone", "Consent at registration"],
        tone: "butter",
        shot: cli("patients", "The patient list with MRN numbers and phone"),
        hotspots: [{ x: 44.1, y: 16.6, label: "Name, MRN or phone" }],
      },
    ],
  },

  construction: {
    hero: {
      shot: con("contract", "A school building contract: BOQ with measured and billed quantities, certified value and money to receive"),
      stack: [
        { label: "Contracts", shot: con("home", "Contracts with how much has been certified") },
        { label: "BOQ", shot: con("contract", "A school building contract: BOQ with measured and billed quantities, certified value and money to receive") },
        { label: "Measurements", shot: con("measurements", "The measurement book: number × length × breadth × depth for each entry") },
        { label: "RA bills", shot: con("bills", "Running account bills with retention, advance recovery, GST and TDS worked out") },
        { label: "Site diary", shot: con("diary", "The site diary: weather, labour by trade and work done each day") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "boq",
        eyebrow: "BOQ",
        title: "Your BOQ, measured and billed.",
        mark: "measured and billed",
        body: "Import the bill of quantities from your spreadsheet. Each item shows how much has been measured on site and how much has gone into bills — with the contract's certified value and what's still to receive.",
        bullets: ["Import the BOQ from Excel or CSV", "Measured vs billed for every item", "Retention, advance, GST and TDS set per contract"],
        tone: "butter",
        shot: con("contract", "A school building contract: BOQ with measured and billed quantities, certified value and money to receive"),
        hotspots: [
          { x: 38.2, y: 42.5, label: "Import your BOQ" },
          { x: 59, y: 31.2, label: "Certified and to receive" },
          { x: 90.1, y: 46.8, label: "Measured vs billed" },
        ],
      },
      {
        key: "mb",
        eyebrow: "Measurement book",
        title: "Measurements the way the site records them.",
        mark: "the way the site records them",
        body: "Enter number, length, breadth and depth — or just a quantity — against a BOQ item and location. Each entry shows who recorded it and whether it's gone into a bill.",
        bullets: ["Nos × L × B × D worked out", "Location and date on each entry", "Checked and billed status"],
        tone: "sky",
        shot: con("measurements", "The measurement book: number × length × breadth × depth for each entry"),
        hotspots: [
          { x: 63, y: 67.3, label: "Nos × L × B × D" },
          { x: 90.5, y: 54.1, label: "In a bill" },
        ],
      },
      {
        key: "bills",
        eyebrow: "RA bills",
        title: "Running bills that do the deductions for you.",
        mark: "do the deductions",
        body: "Prepare the next running account bill from measurements up to a date. Retention, advance recovery, GST and TDS are worked out, and the client's certification is recorded against it.",
        bullets: ["From measurements up to a date", "Retention, advance, GST and TDS", "Submitted, then certified with the client's reference"],
        tone: "mint",
        shot: con("bills", "Running account bills with retention, advance recovery, GST and TDS worked out"),
        hotspots: [
          { x: 62.5, y: 62.7, label: "Deductions worked out" },
          { x: 92.1, y: 51.6, label: "Record certification" },
        ],
      },
      {
        key: "diary",
        eyebrow: "Site diary",
        title: "Every day on site, written down.",
        mark: "written down",
        body: "Note the weather, labour by trade, work done and anything that held you up — one entry a day, signed with who wrote it.",
        bullets: ["Labour by trade", "Weather and hindrances", "A dated record for disputes and claims"],
        tone: "peach",
        shot: con("diary", "The site diary: weather, labour by trade and work done each day"),
        hotspots: [{ x: 50, y: 74.4, label: "Weather, labour, work done" }],
      },
    ],
  },

  education: {
    hero: {
      shot: edu("fees", "Fees to collect: overdue term fees in red and a Take payment button on each"),
      stack: [
        { label: "Fees", shot: edu("fees", "Fees to collect: overdue term fees in red and a Take payment button on each") },
        { label: "Students", shot: edu("students", "Students with class, guardian, concessions and fees due") },
        { label: "Attendance", shot: edu("attendance", "Marking today's attendance for Class 5 A") },
        { label: "Exams", shot: edu("exam", "Half-yearly marks with percentage, grade and rank") },
      ],
    },
    note: NOTE,
    chapters: [
      {
        key: "fees",
        eyebrow: "Fees",
        title: "Fees raised, collected and chased.",
        mark: "collected and chased",
        body: "Set a fee plan once — heads, instalments and due dates — and raise it for whole classes. Take payments by UPI, cash or bank, and see what's overdue at a glance.",
        bullets: ["Fee heads and term instalments", "Concessions per student", "UPI, cash or bank payments", "Overdue shown in red"],
        tone: "butter",
        shot: edu("fees", "Fees to collect: overdue term fees in red and a Take payment button on each"),
        hotspots: [
          { x: 40, y: 21.6, label: "To collect and overdue" },
          { x: 93.2, y: 27.2, label: "Take payment" },
        ],
      },
      {
        key: "students",
        eyebrow: "Students",
        title: "Every student, guardian and rupee due.",
        mark: "rupee due",
        body: "Students with their class, roll number, guardian and fees due — concessions noted. Bring the whole school in from a spreadsheet.",
        bullets: ["Admission numbers given for you", "Guardian details", "Import from Excel or CSV"],
        tone: "sky",
        shot: edu("students", "Students with class, guardian, concessions and fees due"),
        hotspots: [
          { x: 47.3, y: 66, label: "Concession" },
          { x: 95.1, y: 39.8, label: "Overdue in red" },
          { x: 80, y: 10.6, label: "Import" },
        ],
      },
      {
        key: "attendance",
        eyebrow: "Attendance",
        title: "The register in under a minute.",
        mark: "under a minute",
        body: "Pick the class and day, tap everyone present, then mark the few who are absent, late or on leave.",
        bullets: ["Present, absent, late or leave", "Everyone present in one tap", "Monthly view per class"],
        tone: "mint",
        shot: edu("attendance", "Marking today's attendance for Class 5 A"),
        hotspots: [
          { x: 61.8, y: 19.4, label: "Everyone present" },
          { x: 87.8, y: 33.3, label: "Absent" },
        ],
      },
      {
        key: "exams",
        eyebrow: "Exams",
        title: "Marks in, grades and ranks out.",
        mark: "grades and ranks out",
        body: "Enter marks subject by subject; percentage, grade and class rank are worked out as you go.",
        bullets: ["Your subjects and maximum marks", "Percentage, grade and rank", "Marks checked against the maximum"],
        tone: "lavender",
        shot: edu("exam", "Half-yearly marks with percentage, grade and rank"),
        hotspots: [
          { x: 49.6, y: 23.6, label: "Enter marks" },
          { x: 89.5, y: 23.6, label: "Grade and rank" },
        ],
      },
    ],
  },
};
