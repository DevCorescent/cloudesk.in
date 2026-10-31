// "One brief → a whole business": from the approved plan, suggest the store,
// bookable services and a launch marketing kit. Rule-based starter content,
// marked for editing; it never invents prices, reviews or results.
import { industryFor } from "./planner";
import type { ProjectSpec } from "./spec";

export type KitService = { name: string; description: string; durationMin: number; capacity: number };
export type BusinessKit = {
  industry: string;
  store: { recommended: boolean; why: string };
  bookings: { recommended: boolean; why: string; services: KitService[] };
  files: { path: string; title: string; content: string }[];
};

const SERVICES: Record<string, KitService[]> = {
  restaurant: [{ name: "Table reservation", description: "Reserve a table for your group.", durationMin: 90, capacity: 6 }],
  cafe: [{ name: "Table for a group", description: "Reserve a table for 6 or more.", durationMin: 60, capacity: 2 }],
  wellness: [
    { name: "First consultation", description: "Get to know us and plan your treatment.", durationMin: 30, capacity: 1 },
    { name: "Full session", description: "A complete treatment session.", durationMin: 60, capacity: 1 },
  ],
  fitness: [
    { name: "Personal training", description: "One-to-one session with a coach.", durationMin: 60, capacity: 1 },
    { name: "Group class", description: "Small-group class for all levels.", durationMin: 60, capacity: 12 },
    { name: "Free trial session", description: "Try us out before you join.", durationMin: 45, capacity: 1 },
  ],
  consulting: [
    { name: "Discovery call", description: "A short call to understand what you need.", durationMin: 30, capacity: 1 },
    { name: "Strategy session", description: "A focused working session.", durationMin: 90, capacity: 1 },
  ],
  education: [
    { name: "Trial class", description: "Join a class before you enrol.", durationMin: 60, capacity: 10 },
    { name: "Counselling session", description: "Talk through courses and next steps.", durationMin: 30, capacity: 1 },
  ],
  realestate: [{ name: "Property viewing", description: "Visit a property with an agent.", durationMin: 45, capacity: 1 }],
  portfolio: [{ name: "Project enquiry call", description: "Talk through your project and timeline.", durationMin: 30, capacity: 1 }],
  saas: [{ name: "Product demo", description: "A live walkthrough of the product.", durationMin: 30, capacity: 1 }],
  clinic: [
    { name: "Consultation", description: "An initial assessment with a clinician.", durationMin: 20, capacity: 1 },
    { name: "Follow-up visit", description: "Review progress and next steps.", durationMin: 15, capacity: 1 },
  ],
  law: [{ name: "Initial consultation", description: "Discuss your matter confidentially.", durationMin: 45, capacity: 1 }],
  finance: [{ name: "Discovery call", description: "Talk through your books, tax and goals.", durationMin: 30, capacity: 1 }],
  photography: [
    { name: "Portrait session", description: "A relaxed session in studio or on location.", durationMin: 90, capacity: 1 },
    { name: "Planning call", description: "Talk through your date and ideas.", durationMin: 30, capacity: 1 },
  ],
  wedding: [{ name: "Planning consultation", description: "Tell us about your celebration.", durationMin: 60, capacity: 1 }],
  hotel: [{ name: "Spa treatment", description: "Book time in the spa during your stay.", durationMin: 60, capacity: 1 }],
  jewellery: [{ name: "Private viewing", description: "See the collection by appointment.", durationMin: 45, capacity: 1 }],
  architecture: [{ name: "Design consultation", description: "Discuss your site, brief and budget.", durationMin: 60, capacity: 1 }],
  automotive: [
    { name: "Full service", description: "Manufacturer-schedule service.", durationMin: 180, capacity: 2 },
    { name: "Diagnostic check", description: "Find the fault and get a quote.", durationMin: 60, capacity: 2 },
  ],
  homeservices: [{ name: "Home visit & quote", description: "We inspect the job and give a fixed quote.", durationMin: 45, capacity: 1 }],
  petcare: [
    { name: "Full groom", description: "Bath, trim, nails and ears.", durationMin: 90, capacity: 2 },
    { name: "Daycare (full day)", description: "Supervised play and rest.", durationMin: 480, capacity: 10 },
  ],
  travel: [{ name: "Trip planning call", description: "Shape your itinerary with a specialist.", durationMin: 30, capacity: 1 }],
  app: [{ name: "Product demo", description: "A guided tour of the app.", durationMin: 20, capacity: 1 }],
};

const HASHTAGS: Record<string, string> = {
  restaurant: "#foodie #dinner #localeats",
  cafe: "#coffee #bakery #cafelife",
  wellness: "#wellness #selfcare #wellbeing",
  fitness: "#fitness #training #strong",
  consulting: "#business #strategy #growth",
  education: "#learning #education #students",
  realestate: "#realestate #newhome #property",
  store: "#shoplocal #newarrivals #smallbusiness",
  portfolio: "#design #portfolio #creative",
  saas: "#software #productivity #startup",
  clinic: "#health #care #clinic",
  law: "#legal #law #advice",
  finance: "#accounting #tax #smallbusiness",
  photography: "#photography #photographer #portrait",
  wedding: "#wedding #weddingplanner #celebration",
  hotel: "#hotel #travel #staycation",
  jewellery: "#jewellery #handmade #finejewelry",
  architecture: "#architecture #interiordesign #design",
  fashion: "#fashion #style #newcollection",
  music: "#music #livemusic #newmusic",
  automotive: "#cars #carservice #detailing",
  homeservices: "#homeservices #local #repairs",
  petcare: "#pets #dogsofinstagram #petcare",
  nonprofit: "#charity #volunteer #community",
  travel: "#travel #wanderlust #adventure",
  app: "#app #ios #android",
};

export function businessKit(spec: ProjectSpec): BusinessKit {
  const ind = industryFor(spec.industry);
  const name = spec.name;
  const services = [...(SERVICES[ind.key] ?? [{ name: "Consultation", description: "A first conversation about what you need.", durationMin: 30, capacity: 1 }])];
  // Businesses that run classes need group slots, whatever the industry.
  if (/class|batch|workshop|group session/i.test(spec.summary) && !services.some((s) => s.capacity > 1)) services.push({ name: "Group class", description: "Small-group class for all levels.", durationMin: 60, capacity: 12 });
  const sellsProducts = ["store", "fashion", "jewellery"].includes(ind.key) || spec.kind === "store" || /shop|store|sell|product|order online|e-?commerce|merch/i.test(spec.summary);
  const takesBookings = ["restaurant", "wellness", "fitness", "consulting", "education", "realestate", "clinic", "law", "photography", "wedding", "jewellery", "automotive", "homeservices", "petcare"].includes(ind.key) || ind.primary.target === "booking" || /book|appointment|reservation|class|session|consult/i.test(spec.summary);
  const tags = HASHTAGS[ind.key] ?? "#smallbusiness #local";
  const action = ind.primary.label;
  const goal = spec.goals[0] ?? "Grow the business";

  const social = [
    { title: "Launch announcement", text: `We're live! 🎉 ${name} now has a new website. ${ind.heroSub} Take a look — link in bio. ${tags}` },
    { title: "What we do", text: `${ind.features.heading}. ${ind.features.items.map((f) => `${f.title}: ${f.body}`).join(" ")} ${tags}` },
    { title: "Behind the scenes", text: `[Add a photo of your team or workspace] Meet the people behind ${name}. ${ind.story.bullets.length ? ind.story.bullets.map((b) => `✓ ${b}`).join(" ") : "[Add two or three things that make you different]"} ${tags}` },
    { title: "Call to action", text: `${ind.cta}. ${action} on our website — link in bio. ${tags}` },
    { title: "Customer story", text: `[Share a real customer's words, with their permission] What our customers say about ${name}. ${tags}` },
  ];
  const emails = [
    { subject: `Welcome to ${name}`, body: `Hi {{first name}},\n\nThanks for joining us. ${ind.heroSub}\n\nHere's what to expect from our emails: news, offers and the occasional behind-the-scenes look — never spam.\n\n${action}: {{website link}}\n\n— The ${name} team` },
    { subject: `What makes ${name} different`, body: `Hi {{first name}},\n\n${ind.features.items.map((f) => `• ${f.title} — ${f.body}`).join("\n")}\n\n[Add a sentence in your own words about why you started.]\n\n— The ${name} team` },
    { subject: `A small thank-you from ${name}`, body: `Hi {{first name}},\n\n[Offer something real: a discount code, a free consultation or early access. Delete this email if you don't have an offer.]\n\n${action}: {{website link}}\n\n— The ${name} team` },
  ];
  const profile = `${name} — ${ind.label.toLowerCase()}. ${ind.heroSub} ${ind.features.items.map((f) => f.title).join(", ")}.${spec.contact.address ? ` Visit us at ${spec.contact.address}.` : ""} ${action} on our website.`.slice(0, 750);
  const checklist = [
    "Replace all placeholder text and photos on the website (look for [square brackets])",
    "Add your logo and lock your brand colours (Brand)",
    "Publish the site and connect your own domain (Deployments)",
    ...(sellsProducts ? ["Add your products, set up payments and shipping (Online store → Get ready to sell)"] : []),
    ...(takesBookings ? ["Set prices and opening hours for bookings, then switch services on (Online store → Bookings)"] : []),
    "Create or update your Google Business Profile with the description in marketing/google-business.md",
    "Post the launch announcement from marketing/social-posts.md",
    "Turn on Growth to start testing improvements once visitors arrive",
    "Ask three happy customers for a review",
  ];
  const md = (title: string, intro: string, body: string) => `# ${title}\n\n> ${intro}\n\n${body}\n`;
  const files = [
    { path: "marketing/social-posts.md", title: "Social posts", content: md("Social posts", "Starter captions for launch week. Edit them in your own voice and add your photos before posting.", social.map((p, i) => `## ${i + 1}. ${p.title}\n\n${p.text}`).join("\n\n")) },
    { path: "marketing/welcome-emails.md", title: "Welcome emails", content: md("Welcome email series", "Three emails for new subscribers. Replace {{placeholders}} and anything in [square brackets].", emails.map((e, i) => `## Email ${i + 1} — send ${["right away", "after 2 days", "after 5 days"][i]}\n\n**Subject:** ${e.subject}\n\n${e.body}`).join("\n\n")) },
    { path: "marketing/google-business.md", title: "Google Business Profile", content: md("Google Business Profile", "Paste into the “From the business” description (up to 750 characters). Check it is accurate first.", profile) },
    { path: "LAUNCH_CHECKLIST.md", title: "Launch checklist", content: md(`Launch checklist — ${name}`, `Goal: ${goal}. Tick items off as you go.`, checklist.map((c) => `- [ ] ${c}`).join("\n")) },
  ];
  return {
    industry: ind.label,
    store: { recommended: sellsProducts, why: sellsProducts ? "Your plan mentions selling products." : "Add a store if you want to sell online." },
    bookings: { recommended: takesBookings, why: takesBookings ? `${ind.label} businesses usually take bookings online.` : "Add bookings if customers schedule time with you.", services },
    files,
  };
}
