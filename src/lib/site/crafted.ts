// Crafted website templates: complete multi-page sites built section by
// section (not run through the planner), for companies that need an
// enterprise-grade presence on day one. Copy describes what such a business
// does in general terms; anything only the owner can know — clients, numbers,
// quotes, people, addresses — is a [bracketed] placeholder that the design
// review flags before publishing, so nothing invented goes live.
import type { SiteUi } from "./advanced";
import { applyLayout, themeFor } from "./design";
import { photoUrl } from "./media";
import { createSection, newId, siteDocSchema, type Section, type SiteDoc } from "./model";

type Props = Record<string, unknown>;
type Style = Partial<Section["style"]>;
type Link = { label: string; href: string };
type PageDef = { path: string; title: string; description: string; sections: Section[] };

export type CraftedTemplate = {
  id: string;
  personality: string;
  palette: string;
  fontPair: string;
  ui?: SiteUi;
  build: (name: string) => { nav: Link[]; cta: Link; pages: PageDef[] };
};

const img = (id: string, w = 1800) => photoUrl(id, w);

/** A section with props, an optional layout variant and style; the look is re-applied after the layout pass. */
function sec(type: string, props: Props, variant?: string, style?: Style): Section {
  const s = createSection(type);
  Object.assign(s.props, props);
  if (variant) s.variant = variant;
  if (style) s.style = { ...s.style, ...style };
  (s as Section & { _keep?: { variant?: string; style?: Style } })._keep = { variant, style };
  return s;
}

const motion = { entrance: "up" as const, speed: "normal" as const, stagger: true, hover: "lift" as const, parallax: false };

/** Page-top hero for inner pages: compact, left-aligned. */
const pageHero = (eyebrow: string, heading: string, sub: string, image?: string, alt = "") =>
  sec("hero", { eyebrow, heading, subheading: sub, primaryLabel: "", secondaryLabel: "", image: image ? img(image, 2000) : "", imageAlt: alt }, image ? "split" : "minimal", { paddingY: "sm", align: "left" });

/** Builds the site document for a crafted template. */
export function craftedSiteDoc(t: CraftedTemplate, name: string): SiteDoc {
  const { nav, cta, pages } = t.build(name);
  const year = new Date().getFullYear();
  const footerLinks = [...nav, { label: "Privacy", href: "/privacy" }];
  const chrome = (sections: Section[]): Section[] => [
    sec("navbar", { brand: name, links: nav.slice(0, 6), ctaLabel: cta.label, ctaHref: cta.href, showCart: false }, "floating"),
    ...sections,
    sec("footer", { text: `© ${year} ${name}. All rights reserved.`, links: footerLinks }, "columns"),
  ];
  const privacy: PageDef = {
    path: "/privacy",
    title: "Privacy",
    description: `How ${name} handles personal information.`,
    sections: [
      pageHero("Legal", "Privacy policy", "[Have this reviewed by your legal advisor before publishing.]"),
      sec("text", {
        heading: "What we collect",
        body: `[Replace with your policy] When you contact ${name} through this site, we receive the details you choose to share — such as your name, email address and message — and use them only to reply to you.\n\nWe do not sell personal information. To ask about, correct or delete the information we hold about you, write to [privacy@yourcompany.com].`,
      }),
    ],
  };
  const draft = {
    version: 1 as const,
    name,
    lang: "en",
    theme: { ...themeFor(t.personality, { palette: t.palette, fontPair: t.fontPair }), motion: "expressive" as const, ...(t.ui ? { ui: t.ui } : {}) },
    pages: [...pages, privacy].map((p) => ({ id: newId("p"), path: p.path, title: p.path === "/" ? name : p.title, kind: "page" as const, description: p.description.slice(0, 160), sections: chrome(p.sections) })),
  };
  applyLayout(draft as SiteDoc, t.personality);
  // The crafted look wins over the personality's defaults.
  for (const page of draft.pages)
    for (const s of page.sections as (Section & { _keep?: { variant?: string; style?: Style } })[]) {
      if (s._keep?.variant) s.variant = s._keep.variant;
      if (s._keep?.style) s.style = { ...s.style, ...s._keep.style };
      if (!["navbar", "footer", "hero", "marquee"].includes(s.type) && !s.style.motion) s.style.motion = motion;
      delete s._keep;
    }
  return siteDocSchema.parse(draft);
}

// ── Shared building blocks ─────────────────────────────────────────────────

const contactPage = (name: string, heading: string, sub: string, options: string): PageDef => ({
  path: "/contact",
  title: "Contact",
  description: `Get in touch with ${name}.`,
  sections: [
    pageHero("Contact", heading, sub),
    sec(
      "form",
      {
        heading: "Tell us about your project",
        subheading: "A short note is plenty. The right person will reply within one business day.",
        fields: [
          { label: "Name", name: "name", type: "text", required: true, half: true, options: "", placeholder: "" },
          { label: "Work email", name: "email", type: "email", required: true, half: true, options: "", placeholder: "" },
          { label: "Company", name: "company", type: "text", required: false, half: true, options: "", placeholder: "" },
          { label: "What do you need?", name: "topic", type: "select", required: false, half: true, options, placeholder: "" },
          { label: "Details", name: "details", type: "textarea", required: true, half: false, options: "", placeholder: "Goals, timeline, anything we should know" },
        ],
      },
      "split",
    ),
    sec("contact", { heading: "Other ways to reach us", body: "", email: "[hello@yourcompany.com]", phone: "[+91 00000 00000]", whatsapp: "", address: "[Office address]", hours: "Monday to Friday, 9:30 am – 6:30 pm", showForm: false }, "centered"),
  ],
});

const careersPage = (name: string, roles: [string, string][]): PageDef => ({
  path: "/careers",
  title: "Careers",
  description: `Work at ${name}.`,
  sections: [
    pageHero("Careers", `Build what's next with ${name}`, "We hire curious people who care about craft, clarity and the customers they serve.", "1522071820081-009f0129c71c", "Team collaborating on laptops"),
    sec("features", {
      heading: "How we work",
      subheading: "",
      items: [
        { icon: "users", title: "Small, senior teams", body: "Every project is led by people who have done it before — and who stay through delivery." },
        { icon: "lightbulb", title: "Room to learn", body: "A learning budget, internal talks and time set aside to explore new tools." },
        { icon: "heart", title: "Sustainable pace", body: "Clear priorities and realistic plans, so evenings stay yours." },
        { icon: "globe", title: "Hybrid by default", body: "Work from the studio or from home — whatever helps you do your best work." },
      ],
    }, "cards"),
    sec("tabs", { heading: "Open roles", subheading: "[Update with your current openings.]", items: roles.map(([title, body]) => ({ title, body, image: "" })) }, "side"),
    sec("steps", {
      heading: "Our hiring process",
      subheading: "Usually two to three weeks from first call to offer.",
      items: [
        { title: "Intro call", body: "A 30-minute conversation about you, the role and the team." },
        { title: "Craft exercise", body: "A short, paid exercise close to real work — no trick questions." },
        { title: "Team conversations", body: "Meet the people you would work with every day." },
        { title: "Offer", body: "A clear offer, with time to ask anything before you decide." },
      ],
    }, "numbered"),
    sec("cta", { heading: "Don't see your role?", body: "Send us a note about what you do best — we read every one.", buttonLabel: "Get in touch", buttonHref: "/contact" }, "band"),
  ],
});

const proofPlaceholders = (heading = "Trusted by teams at") => sec("logos", { heading, items: ["[Client one]", "[Client two]", "[Client three]", "[Client four]", "[Client five]"].map((n) => ({ name: n })), _example: true }, "row");

const quotePlaceholders = () =>
  sec("testimonials", { heading: "What clients say", items: [1, 2, 3].map(() => ({ quote: "[Replace with a real client quote — with their permission.]", author: "[Client name]", role: "[Role, Company]" })) }, "grid");

const teamPlaceholders = (heading: string) =>
  sec("team", { heading, subheading: "", members: ["Founder & CEO", "Head of Delivery", "Head of Design", "Head of Engineering"].map((role) => ({ name: "[Name]", role, photo: "", bio: "" })), _example: true }, "grid");

// ── The templates ───────────────────────────────────────────────────────────

export const CRAFTED: Record<string, CraftedTemplate> = {
  // Enterprise IT services & digital engineering.
  "tech-enterprise": {
    id: "tech-enterprise",
    personality: "corporate",
    palette: "porcelain",
    fontPair: "startup",
    ui: { header: "glass", headingWeight: 600, headingSpacing: -0.03, buttonSize: "lg", container: 1240 },
    build: (name) => ({
      nav: [{ label: "Services", href: "/services" }, { label: "Industries", href: "/industries" }, { label: "About", href: "/about" }, { label: "Careers", href: "/careers" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Talk to us", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — digital engineering, cloud and data services for enterprises.`,
          sections: [
            sec("hero", { eyebrow: "Digital engineering · Cloud · Data & AI", heading: "Technology that moves your business forward.", subheading: "We help enterprises modernise platforms, move to the cloud and put data to work — with senior teams accountable from strategy to support.", primaryLabel: "Talk to an expert", primaryHref: "/contact", secondaryLabel: "Explore services", secondaryHref: "/services", image: img("1486406146926-c627a92ad1ab", 2200), imageAlt: "Glass office towers seen from below" }, "overlay"),
            proofPlaceholders(),
            sec("features", {
              heading: "End-to-end capabilities",
              subheading: "One partner from roadmap to run — so nothing gets lost between vendors.",
              items: [
                { icon: "code", title: "Product engineering", body: "Web, mobile and platform builds with modern, well-tested architecture." },
                { icon: "layers", title: "Cloud & DevOps", body: "Migration, cloud-native rebuilds, CI/CD and infrastructure as code." },
                { icon: "chart", title: "Data & AI", body: "Data platforms, analytics and production-grade machine learning." },
                { icon: "shield", title: "Cybersecurity", body: "Security reviews, identity, compliance readiness and secure SDLC." },
                { icon: "briefcase", title: "Enterprise applications", body: "ERP and CRM implementation, integration and modernisation." },
                { icon: "handshake", title: "Managed services", body: "24×7 monitoring, support and continuous improvement under clear SLAs." },
              ],
            }, "cards"),
            sec("split", { eyebrow: "How we engage", heading: "Outcomes first, then technology", body: "Every engagement starts with the business result you need — faster releases, lower run costs, better decisions — and works back to the plan.", bullets: ["Discovery workshops with your stakeholders", "Fixed-scope pilots before large commitments", "Transparent reporting every sprint"], image: img("1542744173-8e7e53415bb0", 1400), imageAlt: "Team meeting in a conference room", buttonLabel: "Our approach", buttonHref: "/about" }, "image-right"),
            sec("stats", { heading: "", subheading: "", items: [{ value: "[00]+", label: "Enterprise clients" }, { value: "[00]", label: "Countries served" }, { value: "[000]+", label: "Engineers" }, { value: "[00]%", label: "Repeat business" }], _example: true }, "cards"),
            sec("tabs", {
              heading: "Industries we serve",
              subheading: "",
              items: [
                { title: "Banking & financial services", body: "Core modernisation, digital channels and regulatory reporting on secure, auditable platforms.", image: img("1611974789855-9c2a0a7236a3", 1200) },
                { title: "Healthcare & life sciences", body: "Patient-facing apps and data platforms built with privacy and compliance in mind.", image: img("1576091160399-112ba8d25d1d", 1200) },
                { title: "Retail & consumer", body: "Commerce platforms, personalisation and supply-chain visibility.", image: img("1441986300917-64674bd600d8", 1200) },
                { title: "Manufacturing", body: "Connected operations, IoT data and predictive maintenance.", image: img("1518770660439-4636190af475", 1200) },
              ],
            }, "side"),
            quotePlaceholders(),
            sec("cta", { heading: "Let's plan your next platform.", body: "A 45-minute working session with a solutions architect — no slide decks.", buttonLabel: "Book a session", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/services",
          title: "Services",
          description: `Services offered by ${name}.`,
          sections: [
            pageHero("Services", "Capabilities built for scale", "Senior teams that design, build and run critical systems — and stay accountable for the outcome.", "1498050108023-c5249f4df085", "Laptop showing code"),
            sec("features", {
              heading: "Engineering",
              subheading: "",
              items: [
                { icon: "code", title: "Custom software", body: "Product discovery, UX, architecture and delivery for web and mobile." },
                { icon: "layers", title: "Platform modernisation", body: "Re-architect legacy systems into maintainable, cloud-ready services." },
                { icon: "check", title: "Quality engineering", body: "Test automation, performance and accessibility built into delivery." },
              ],
            }, "cards"),
            sec("features", {
              heading: "Cloud, data & security",
              subheading: "",
              items: [
                { icon: "globe", title: "Cloud migration", body: "Assess, plan and migrate workloads with minimal disruption." },
                { icon: "chart", title: "Data engineering", body: "Pipelines, warehouses and governance your teams can trust." },
                { icon: "lightbulb", title: "Applied AI", body: "Use cases with measurable value, deployed responsibly." },
                { icon: "shield", title: "Security & compliance", body: "Threat modelling, identity, audits and readiness for common standards." },
              ],
            }, "icons"),
            sec("steps", {
              heading: "How a typical engagement runs",
              subheading: "",
              items: [
                { title: "Discover", body: "Goals, constraints and success measures, agreed in writing." },
                { title: "Design", body: "Architecture, plan and a fixed-scope pilot." },
                { title: "Deliver", body: "Two-week sprints with demos and shared dashboards." },
                { title: "Run & improve", body: "Support, monitoring and a quarterly roadmap review." },
              ],
            }, "timeline"),
            sec("comparison", {
              heading: "Engagement models",
              subheading: "Choose what fits — and change as your needs do.",
              columns: ["Project", "Dedicated team", "Managed service"],
              highlight: 2,
              rows: [
                { feature: "Best for", values: "Defined scope | Ongoing roadmap | Run & support" },
                { feature: "Pricing", values: "Fixed price | Monthly team | SLA-based" },
                { feature: "Your involvement", values: "Milestone reviews | Daily collaboration | Quarterly reviews" },
                { feature: "Scale up or down", values: "no | yes | yes" },
              ],
            }, "table"),
            sec("cta", { heading: "Not sure where to start?", body: "Tell us the problem; we'll suggest the smallest useful first step.", buttonLabel: "Contact us", buttonHref: "/contact" }, "band"),
          ],
        },
        {
          path: "/industries",
          title: "Industries",
          description: `Industries ${name} works with.`,
          sections: [
            pageHero("Industries", "Deep context in the industries we serve", "Domain-aware teams who already speak your language — and know your regulations.", "1497366216548-37526070297c", "Modern office corridor"),
            sec("features", {
              heading: "Where we work",
              subheading: "",
              items: [
                { icon: "chart", title: "Financial services", body: "Banks, NBFCs, insurers and fintechs." },
                { icon: "heart", title: "Healthcare", body: "Providers, diagnostics and health-tech." },
                { icon: "bag", title: "Retail & e-commerce", body: "Brands, marketplaces and omnichannel retail." },
                { icon: "layers", title: "Manufacturing", body: "Industrial, automotive and supply chain." },
                { icon: "education", title: "Education", body: "Ed-tech platforms and institutions." },
                { icon: "globe", title: "Travel & logistics", body: "Booking, fleet and fulfilment systems." },
              ],
            }, "cards"),
            sec("split", { eyebrow: "Compliance-ready", heading: "Built for regulated environments", body: "We design for audit trails, data residency and least-privilege access from day one — not as an afterthought.", bullets: ["Documented controls and change management", "Data protection by design", "[Add the certifications you hold]"], image: img("1450101499163-c8848c66ca85", 1400), imageAlt: "Hands signing a document" }, "image-left"),
            sec("cta", { heading: "Talk to an industry lead", body: "", buttonLabel: "Contact us", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/about",
          title: "About",
          description: `About ${name}.`,
          sections: [
            pageHero("About us", `Engineering partners, not just vendors`, `[Replace with your story] ${name} was founded to give enterprises the senior, accountable engineering teams they deserve.`, "1519389950473-47ba0277781c", "Team desks seen from above"),
            sec("features", {
              heading: "What we believe",
              subheading: "",
              items: [
                { icon: "target", title: "Outcomes over output", body: "We measure success by the business result, not hours billed." },
                { icon: "check", title: "Quality is non-negotiable", body: "Tests, reviews and documentation ship with every feature." },
                { icon: "handshake", title: "Plain-spoken partnership", body: "We say what's working, what isn't and what we'd do next." },
              ],
            }, "numbered"),
            sec("timeline", { heading: "Our journey", subheading: "[Replace with your milestones.]", items: [{ date: "[Year]", title: "Founded", body: "[Where and why you started.]" }, { date: "[Year]", title: "[Milestone]", body: "[What changed.]" }, { date: "Today", title: "[Where you are now]", body: "[Teams, offices, focus.]" }] }, "horizontal"),
            teamPlaceholders("Leadership"),
            sec("cta", { heading: "Join us or work with us", body: "", buttonLabel: "See careers", buttonHref: "/careers" }, "band"),
          ],
        },
        careersPage(name, [
          ["Senior Software Engineer", "[Location · Full-time] Build and ship customer platforms with a senior team."],
          ["Cloud Architect", "[Location · Full-time] Lead migrations and cloud-native designs for enterprise clients."],
          ["Data Engineer", "[Location · Full-time] Design pipelines and data platforms teams can trust."],
          ["Engagement Manager", "[Location · Full-time] Own delivery outcomes and client relationships."],
        ]),
        contactPage(name, "Let's talk about what you're building", "Share a little about your goals and we'll connect you with the right specialist.", "Product engineering, Cloud & DevOps, Data & AI, Security, Something else"),
      ],
    }),
  },

  // SaaS / cloud product.
  "saas-platform": {
    id: "saas-platform",
    personality: "glass",
    palette: "aurora",
    fontPair: "tech",
    ui: { header: "glass", headingWeight: 600, headingSpacing: -0.04, buttonSize: "lg" },
    build: (name) => ({
      nav: [{ label: "Product", href: "/product" }, { label: "Pricing", href: "/pricing" }, { label: "Security", href: "/security" }, { label: "Company", href: "/company" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Book a demo", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — one platform for your team's operations.`,
          sections: [
            sec("hero", { eyebrow: "New · [Your latest release]", heading: "The operating system for modern teams.", subheading: `${name} brings projects, data and automation into one fast, secure workspace — so your team spends less time switching tools and more time shipping.`, primaryLabel: "Start free trial", primaryHref: "/contact", secondaryLabel: "See the product", secondaryHref: "/product", image: img("1460925895917-afdab827c52f", 2200), imageAlt: "Analytics dashboard on a laptop" }, "centered", { decor: "glow" }),
            proofPlaceholders("Teams that run on " + name),
            sec("features", {
              heading: "Everything in one place",
              subheading: "Replace scattered spreadsheets and point tools with one connected workspace.",
              items: [
                { icon: "layers", title: "Unified workspace", body: "Projects, docs and data in a single, searchable home." },
                { icon: "zap", title: "No-code automations", body: "Trigger workflows from any change — no engineers required." },
                { icon: "chart", title: "Live dashboards", body: "Real-time reporting from the data you already have." },
                { icon: "lock", title: "Enterprise security", body: "SSO, roles and audit logs on every plan that needs them." },
                { icon: "globe", title: "Integrations", body: "Connect the tools you use with webhooks and an open API." },
                { icon: "sparkles", title: "AI assistant", body: "Summaries, drafts and answers grounded in your workspace." },
              ],
            }, "cards"),
            sec("tabs", {
              heading: "Built for every team",
              subheading: "",
              items: [
                { title: "Operations", body: "Standardise processes and see bottlenecks before they cost you.", image: img("1551434678-e076c223a692", 1200) },
                { title: "Product & engineering", body: "Plan roadmaps, track releases and keep stakeholders in the loop.", image: img("1498050108023-c5249f4df085", 1200) },
                { title: "Leadership", body: "One view of goals, progress and risk across the company.", image: img("1542744173-8e7e53415bb0", 1200) },
              ],
            }, "pills"),
            sec("stats", { heading: "", subheading: "", items: [{ value: "[00]k+", label: "Active users" }, { value: "[00]%", label: "Uptime last 12 months" }, { value: "[0]x", label: "Faster reporting" }], _example: true }, "cards"),
            quotePlaceholders(),
            sec("faq", {
              heading: "Questions, answered",
              items: [
                { question: "Is there a free trial?", answer: "[Edit to match your offer] Yes — try every feature free for 14 days. No card required." },
                { question: "Can we import our existing data?", answer: "Yes. Import from CSV or connect your tools through integrations and the API." },
                { question: "How is our data protected?", answer: "Data is encrypted in transit and at rest, with role-based access and audit logs. See the Security page for details." },
                { question: "Do you offer onboarding?", answer: "[Edit to match your offer] Every paid plan includes guided onboarding; larger teams get a dedicated success manager." },
              ],
            }, "split"),
            sec("cta", { heading: "See it with your own data.", body: "Book a 30-minute demo tailored to your team.", buttonLabel: "Book a demo", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/product",
          title: "Product",
          description: `A tour of ${name}.`,
          sections: [
            pageHero("Product", "Fast, flexible and secure by design", "A tour of the building blocks your team will use every day.", "1551650975-87deedd944c3", "Phone showing an app beside a laptop"),
            sec("split", { eyebrow: "Workspace", heading: "One home for every project", body: "Organise work in spaces, link docs to tasks and find anything in seconds with global search.", bullets: ["Views for lists, boards and timelines", "Real-time collaboration", "Granular permissions"], image: img("1522071820081-009f0129c71c", 1400), imageAlt: "Team collaborating on laptops" }, "image-left"),
            sec("split", { eyebrow: "Automation", heading: "Let the busywork run itself", body: "Build workflows with triggers and actions, then watch every run in a clear activity log.", bullets: ["Triggers from any change or schedule", "Approvals and notifications", "Retries and error alerts"], image: img("1550751827-4bd374c3f58b", 1400), imageAlt: "Glowing circuit lines" }, "image-right"),
            sec("split", { eyebrow: "Insights", heading: "Decisions from live data", body: "Dashboards update as work happens, so reviews are about decisions — not compiling numbers.", bullets: ["Drag-and-drop charts", "Scheduled reports", "Export anywhere"], image: img("1460925895917-afdab827c52f", 1400), imageAlt: "Analytics dashboard" }, "image-left"),
            sec("cta", { heading: "Ready to try it?", body: "", buttonLabel: "Start free trial", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/pricing",
          title: "Pricing",
          description: `${name} plans and pricing.`,
          sections: [
            pageHero("Pricing", "Simple plans that grow with you", "[Edit prices and limits to match your plans.]"),
            sec("pricing", {
              heading: "",
              subheading: "",
              plans: [
                { name: "Starter", price: "₹0", period: "/forever", features: ["Up to 3 users", "Core workspace", "Community support"], ctaLabel: "Start free", ctaHref: "/contact", highlighted: false },
                { name: "Growth", price: "[₹000]", period: "/user/month", features: ["Unlimited projects", "Automations", "Dashboards", "Email support"], ctaLabel: "Start trial", ctaHref: "/contact", highlighted: true },
                { name: "Enterprise", price: "Custom", period: "", features: ["SSO & audit logs", "Advanced security", "Dedicated success manager", "Uptime SLA"], ctaLabel: "Talk to sales", ctaHref: "/contact", highlighted: false },
              ],
            }, "cards"),
            sec("comparison", {
              heading: "Compare plans",
              subheading: "",
              columns: ["Starter", "Growth", "Enterprise"],
              highlight: 2,
              rows: [
                { feature: "Users", values: "Up to 3 | Unlimited | Unlimited" },
                { feature: "Automations", values: "no | yes | yes" },
                { feature: "SSO / SAML", values: "no | no | yes" },
                { feature: "Audit logs", values: "no | no | yes" },
                { feature: "Support", values: "Community | Email | Dedicated" },
              ],
            }, "table"),
            sec("faq", { heading: "Billing questions", items: [{ question: "Can I change plans later?", answer: "Yes — upgrade or downgrade any time; changes are prorated." }, { question: "Do you offer annual billing?", answer: "[Edit to match your offer] Yes, with two months free on annual plans." }] }, "list"),
          ],
        },
        {
          path: "/security",
          title: "Security",
          description: `How ${name} keeps your data safe.`,
          sections: [
            pageHero("Trust & security", "Security you can verify", "How we protect your data — and how you can check.", "1518770660439-4636190af475", "Close-up of a circuit board"),
            sec("features", {
              heading: "Controls at every layer",
              subheading: "",
              items: [
                { icon: "lock", title: "Encryption", body: "TLS in transit and encryption at rest for all customer data." },
                { icon: "users", title: "Access control", body: "Role-based permissions, SSO and enforced two-factor sign-in." },
                { icon: "check", title: "Audit trail", body: "Every sensitive action is logged and exportable." },
                { icon: "shield", title: "Secure development", body: "Code review, dependency scanning and regular penetration tests." },
              ],
            }, "cards"),
            sec("text", { heading: "Compliance", body: "[List only the certifications and audits you actually hold, with dates.]\n\nFor security questionnaires or to report a vulnerability, contact [security@yourcompany.com]." }, "lead"),
          ],
        },
        {
          path: "/company",
          title: "Company",
          description: `About ${name}.`,
          sections: [
            pageHero("Company", "We build calm software for busy teams", `[Replace with your story] ${name} started when we got tired of stitching together tools that never talked to each other.`, "1556761175-5973dc0f32e7", "Presentation in a coworking space"),
            teamPlaceholders("Leadership"),
            sec("timeline", { heading: "Milestones", subheading: "[Replace with your milestones.]", items: [{ date: "[Year]", title: "Founded", body: "[Your first step.]" }, { date: "[Year]", title: "[Launch]", body: "[What shipped.]" }, { date: "Today", title: "[Now]", body: "[Where you are.]" }] }, "alternating"),
          ],
        },
        contactPage(name, "Book a demo", "See how the platform fits your team. We'll tailor the walkthrough to your use case.", "Demo, Pricing, Security review, Partnership, Something else"),
      ],
    }),
  },

  // AI product studio / startup.
  "ai-startup": {
    id: "ai-startup",
    personality: "dark-tech",
    palette: "dusk",
    fontPair: "avant",
    ui: { header: "glass", headingWeight: 700, headingSpacing: -0.05, buttonSize: "lg" },
    build: (name) => ({
      nav: [{ label: "Platform", href: "/platform" }, { label: "Use cases", href: "/use-cases" }, { label: "Company", href: "/company" }, { label: "Careers", href: "/careers" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Request access", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — applied AI for real work.`,
          sections: [
            sec("hero", { eyebrow: "Applied AI · Built for production", heading: "AI that does the work, not just the demo.", subheading: `${name} turns your documents, data and workflows into reliable AI agents — with the controls your security team will actually sign off on.`, primaryLabel: "Request access", primaryHref: "/contact", secondaryLabel: "How it works", secondaryHref: "/platform", image: img("1550751827-4bd374c3f58b", 2200), imageAlt: "Glowing circuit lines in the dark" }, "editorial", { decor: "glow" }),
            sec("marquee", { items: ["Agents", "Retrieval", "Evaluation", "Guardrails", "Observability", "On-prem ready"], separator: "✦", speed: "slow", reverse: false }, "outline", { paddingY: "sm" }),
            sec("features", {
              heading: "From prototype to production",
              subheading: "",
              items: [
                { icon: "magic", title: "Agents with tools", body: "Connect models to your systems with approvals at every step that matters." },
                { icon: "layers", title: "Grounded answers", body: "Retrieval over your own documents, with citations users can check." },
                { icon: "chart", title: "Evaluation built in", body: "Test quality on your own examples before and after every change." },
                { icon: "shield", title: "Guardrails & audit", body: "Policies, PII redaction and a full log of every action." },
              ],
            }, "cards"),
            sec("steps", { heading: "Live in weeks, not quarters", subheading: "", items: [{ title: "Pick one workflow", body: "Start where the value is clearest and easiest to measure." }, { title: "Connect your data", body: "Secure connectors to the systems that hold the answers." }, { title: "Evaluate", body: "Score real examples with your team before anything ships." }, { title: "Roll out", body: "Launch to a pilot group, monitor, then scale." }] }, "timeline"),
            sec("stats", { heading: "", subheading: "", items: [{ value: "[00]%", label: "Less time on routine work" }, { value: "[0] wks", label: "Typical time to pilot" }, { value: "[00]+", label: "Workflows in production" }], _example: true }, "row"),
            quotePlaceholders(),
            sec("cta", { heading: "Bring one workflow. Leave with a pilot plan.", body: "", buttonLabel: "Request access", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/platform",
          title: "Platform",
          description: `The ${name} platform.`,
          sections: [
            pageHero("Platform", "Everything you need to run AI safely", "Models, data, evaluation and controls in one place."),
            sec("split", { eyebrow: "Build", heading: "Design agents visually or in code", body: "Define tools, prompts and policies — then version and review them like any other software.", bullets: ["Visual builder and SDK", "Versioning and rollbacks", "Human-in-the-loop approvals"], image: img("1531297484001-80022131f5a1", 1400), imageAlt: "Laptop glowing in the dark" }, "image-left"),
            sec("split", { eyebrow: "Measure", heading: "Know it works before users do", body: "Run evaluations on your own test sets and compare every change side by side.", bullets: ["Custom scorecards", "Regression alerts", "Cost and latency tracking"], image: img("1611974789855-9c2a0a7236a3", 1400), imageAlt: "Chart on a dark screen" }, "image-right"),
            sec("features", { heading: "Deploy your way", subheading: "", items: [{ icon: "globe", title: "Cloud", body: "Fully managed in [your regions]." }, { icon: "lock", title: "Private cloud", body: "In your VPC with your keys." }, { icon: "shield", title: "On-premises", body: "[Available on Enterprise plans.]" }] }, "cards"),
            sec("cta", { heading: "See the platform", body: "", buttonLabel: "Request a demo", buttonHref: "/contact" }, "band"),
          ],
        },
        {
          path: "/use-cases",
          title: "Use cases",
          description: `What teams build with ${name}.`,
          sections: [
            pageHero("Use cases", "Where AI pays off first", "Common starting points — each one measurable within a pilot."),
            sec("tabs", {
              heading: "",
              subheading: "",
              items: [
                { title: "Customer support", body: "Draft accurate replies from your help centre and past tickets, with agent review.", image: img("1555774698-0b77e0d5fac6", 1200) },
                { title: "Document processing", body: "Extract, check and route data from invoices, contracts and forms.", image: img("1554224155-6726b3ff858f", 1200) },
                { title: "Knowledge search", body: "Answer internal questions with citations to the source document.", image: img("1517245386807-bb43f82c33c4", 1200) },
                { title: "Sales operations", body: "Summarise calls, update the CRM and prepare follow-ups automatically.", image: img("1600880292203-757bb62b4baf", 1200) },
              ],
            }, "side"),
            sec("cta", { heading: "Have a different workflow in mind?", body: "", buttonLabel: "Tell us about it", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/company",
          title: "Company",
          description: `About ${name}.`,
          sections: [
            pageHero("Company", "Researchers and engineers who ship", `[Replace with your story] ${name} was founded to close the gap between AI research and dependable software.`),
            teamPlaceholders("Founding team"),
            sec("text", { heading: "Our principles", body: "Measure before you scale. Keep humans in charge of consequential decisions. Be honest about what models can and can't do." }, "lead"),
          ],
        },
        careersPage(name, [
          ["Applied AI Engineer", "[Location · Full-time] Build and evaluate agents for real customer workflows."],
          ["Platform Engineer", "[Location · Full-time] Scale the infrastructure that runs models in production."],
          ["Solutions Engineer", "[Location · Full-time] Help customers design pilots that prove value."],
        ]),
        contactPage(name, "Request access", "Tell us about the workflow you'd like to automate first.", "Pilot, Platform demo, Security review, Partnership, Other"),
      ],
    }),
  },

  // Performance & brand marketing agency.
  "marketing-agency": {
    id: "marketing-agency",
    personality: "bold",
    palette: "citrus",
    fontPair: "bold",
    ui: { header: "sticky", headingWeight: 800, headingSpacing: -0.05, buttonUppercase: true },
    build: (name) => ({
      nav: [{ label: "Services", href: "/services" }, { label: "Work", href: "/work" }, { label: "Process", href: "/process" }, { label: "About", href: "/about" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Get a proposal", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — brand and performance marketing that grows revenue.`,
          sections: [
            sec("hero", { eyebrow: "Brand · Performance · Content", heading: "Marketing that shows up in revenue.", subheading: `${name} plans, creates and runs campaigns across search, social and content — and reports on the numbers that matter to your business.`, primaryLabel: "Get a proposal", primaryHref: "/contact", secondaryLabel: "See our work", secondaryHref: "/work", image: img("1600880292203-757bb62b4baf", 2200), imageAlt: "Colleagues celebrating in a meeting" }, "editorial"),
            sec("marquee", { items: ["Performance marketing", "SEO", "Social", "Content", "Brand strategy", "Analytics"], separator: "●", speed: "normal", reverse: false }, "bold", { paddingY: "sm" }),
            proofPlaceholders("Brands we've grown"),
            sec("features", {
              heading: "What we do",
              subheading: "Full-funnel marketing, run by specialists who talk to each other.",
              items: [
                { icon: "target", title: "Performance marketing", body: "Search, social and marketplace ads managed for return, not reach." },
                { icon: "chart", title: "SEO", body: "Technical fixes, content and links that compound over time." },
                { icon: "chat", title: "Social media", body: "Always-on content, community and creator partnerships." },
                { icon: "camera", title: "Content & creative", body: "Video, design and copy produced in-house." },
                { icon: "lightbulb", title: "Brand strategy", body: "Positioning, messaging and identity that set you apart." },
                { icon: "layers", title: "Analytics", body: "Tracking, dashboards and honest attribution." },
              ],
            }, "numbered"),
            sec("split", { eyebrow: "Our promise", heading: "No vanity metrics", body: "We agree on business goals up front — leads, sales, cost per acquisition — and report against them every month in plain language.", bullets: ["Clear goals before we spend", "Monthly reviews with real numbers", "You own every account and asset"], image: img("1460925895917-afdab827c52f", 1400), imageAlt: "Analytics dashboard on a laptop", buttonLabel: "How we work", buttonHref: "/process" }, "image-right"),
            sec("stats", { heading: "", subheading: "", items: [{ value: "[₹00 Cr]", label: "Ad spend managed" }, { value: "[00]+", label: "Brands served" }, { value: "[0.0]x", label: "Average ROAS" }], _example: true }, "row"),
            quotePlaceholders(),
            sec("cta", { heading: "Let's grow something.", body: "Get a free audit of your current marketing with three clear next steps.", buttonLabel: "Get a free audit", buttonHref: "/contact" }, "band"),
          ],
        },
        {
          path: "/services",
          title: "Services",
          description: `Marketing services from ${name}.`,
          sections: [
            pageHero("Services", "Pick one channel or the whole funnel", "Every service comes with a named lead, clear goals and monthly reporting.", "1556761175-5973dc0f32e7", "Presentation in a coworking space"),
            sec("tabs", {
              heading: "",
              subheading: "",
              items: [
                { title: "Performance marketing", body: "Google, Meta, LinkedIn and marketplace ads. Account audits, structure, creative testing and budget pacing.", image: img("1460925895917-afdab827c52f", 1200) },
                { title: "SEO & content", body: "Technical audits, keyword strategy, on-page optimisation and editorial calendars.", image: img("1501504905252-473c47e087f8", 1200) },
                { title: "Social media", body: "Strategy, content production, community management and creator collaborations.", image: img("1563986768609-322da13575f3", 1200) },
                { title: "Brand & creative", body: "Positioning, identity systems, campaign concepts and video production.", image: img("1452860606245-08befc0ff44b", 1200) },
              ],
            }, "side"),
            sec("pricing", {
              heading: "Retainers",
              subheading: "[Edit to match your packages.]",
              plans: [
                { name: "Launch", price: "[₹00,000]", period: "/month", features: ["One channel", "Monthly report", "Fortnightly check-in"], ctaLabel: "Enquire", ctaHref: "/contact", highlighted: false },
                { name: "Grow", price: "[₹00,000]", period: "/month", features: ["Up to three channels", "Creative production", "Weekly check-in", "Live dashboard"], ctaLabel: "Enquire", ctaHref: "/contact", highlighted: true },
                { name: "Scale", price: "Custom", period: "", features: ["Full-funnel team", "Brand & performance", "Quarterly strategy reviews"], ctaLabel: "Talk to us", ctaHref: "/contact", highlighted: false },
              ],
            }, "cards"),
          ],
        },
        {
          path: "/work",
          title: "Work",
          description: `Selected work by ${name}.`,
          sections: [
            pageHero("Work", "Selected work", "[Replace these with your case studies — with each client's permission.]"),
            sec("gallery", { heading: "", images: [["1542744173-8e7e53415bb0", "[Client] — campaign"], ["1556761175-5973dc0f32e7", "[Client] — brand launch"], ["1600880292203-757bb62b4baf", "[Client] — performance"], ["1517245386807-bb43f82c33c4", "[Client] — content"], ["1522071820081-009f0129c71c", "[Client] — social"], ["1497215728101-856f4ea42174", "[Client] — rebrand"]].map(([id, alt]) => ({ src: img(id, 1200), alt })) }, "masonry"),
            sec("features", { heading: "Case study format", subheading: "Each case study answers three questions.", items: [{ icon: "target", title: "The challenge", body: "What the client needed to change, in their words." }, { icon: "lightbulb", title: "What we did", body: "The strategy, channels and creative." }, { icon: "chart", title: "The result", body: "Verified numbers, with the period they cover." }] }, "cards"),
          ],
        },
        {
          path: "/process",
          title: "Process",
          description: `How ${name} works.`,
          sections: [
            pageHero("Process", "A clear process, every time", "So you always know what's happening, what's next and why."),
            sec("steps", { heading: "", subheading: "", items: [{ title: "Audit", body: "We review your channels, tracking and creative — and share findings within a week." }, { title: "Strategy", body: "Goals, budget split, channel plan and a 90-day roadmap." }, { title: "Launch", body: "Campaigns, content and tracking go live in planned phases." }, { title: "Optimise", body: "Weekly tests and budget moves based on what's working." }, { title: "Report", body: "Monthly reviews in plain language with next steps." }] }, "timeline"),
            sec("faq", { heading: "Working together", items: [{ question: "Do we own our ad accounts?", answer: "Always. Accounts, data and creative stay in your name." }, { question: "Is there a minimum term?", answer: "[Edit to match your terms] Retainers start with a three-month term, then roll monthly." }, { question: "How soon will we see results?", answer: "Paid channels usually show signal within weeks; SEO typically takes several months to compound." }] }, "split"),
          ],
        },
        {
          path: "/about",
          title: "About",
          description: `About ${name}.`,
          sections: [
            pageHero("About", "A team of specialists, one shared goal", `[Replace with your story] ${name} brings strategists, media buyers and creatives under one roof.`, "1522071820081-009f0129c71c", "Team collaborating on laptops"),
            teamPlaceholders("The team"),
            sec("cta", { heading: "Want to work with us?", body: "", buttonLabel: "Get in touch", buttonHref: "/contact" }, "band"),
          ],
        },
        contactPage(name, "Let's grow your brand", "Tell us where you are and where you want to be. We'll come back with a plan.", "Performance marketing, SEO, Social media, Brand & creative, Full-funnel"),
      ],
    }),
  },

  // Branding & design studio.
  "design-studio": {
    id: "design-studio",
    personality: "editorial",
    palette: "paper",
    fontPair: "gallery",
    ui: { header: "sticky", headingWeight: 400, headingSpacing: -0.03, sectionSpace: 1.15 },
    build: (name) => ({
      nav: [{ label: "Work", href: "/work" }, { label: "Services", href: "/services" }, { label: "Studio", href: "/studio" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Start a project", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — brand identity, digital design and art direction.`,
          sections: [
            sec("hero", { eyebrow: "Independent design studio", heading: "We design brands people remember.", subheading: `${name} creates identities, websites and campaigns for companies that care how they look and sound.`, primaryLabel: "See the work", primaryHref: "/work", secondaryLabel: "Start a project", secondaryHref: "/contact", image: img("1499951360447-b19be8fe80f5", 2200), imageAlt: "Tidy creative workspace" }, "editorial"),
            sec("gallery", { heading: "Selected work", images: [["1452860606245-08befc0ff44b", "[Project] — identity"], ["1586023492125-27b2c045efd7", "[Project] — art direction"], ["1487958449943-2429e8be8625", "[Project] — architecture brand"], ["1513694203232-719a280e022f", "[Project] — interiors"], ["1499951360447-b19be8fe80f5", "[Project] — website"]].map(([id, alt]) => ({ src: img(id, 1400), alt })) }, "masonry"),
            sec("features", { heading: "What we do", subheading: "", items: [{ icon: "palette", title: "Brand identity", body: "Strategy, naming, logo systems and guidelines." }, { icon: "globe", title: "Digital design", body: "Websites and products with a clear point of view." }, { icon: "camera", title: "Art direction", body: "Photography, campaigns and content that feel like you." }] }, "numbered"),
            quotePlaceholders(),
            sec("cta", { heading: "Have a project in mind?", body: "", buttonLabel: "Start a project", buttonHref: "/contact" }, "band"),
          ],
        },
        {
          path: "/work",
          title: "Work",
          description: `Projects by ${name}.`,
          sections: [
            pageHero("Work", "Projects", "[Replace with your projects and credits.]"),
            sec("gallery", { heading: "", images: [["1452860606245-08befc0ff44b", "[Project one]"], ["1487958449943-2429e8be8625", "[Project two]"], ["1586023492125-27b2c045efd7", "[Project three]"], ["1513694203232-719a280e022f", "[Project four]"], ["1499951360447-b19be8fe80f5", "[Project five]"], ["1501504905252-473c47e087f8", "[Project six]"]].map(([id, alt]) => ({ src: img(id, 1400), alt })) }, "grid"),
          ],
        },
        {
          path: "/services",
          title: "Services",
          description: `Services from ${name}.`,
          sections: [
            pageHero("Services", "How we can help", "Engagements usually run six to twelve weeks."),
            sec("tabs", { heading: "", subheading: "", items: [{ title: "Brand strategy", body: "Research, positioning and messaging that give the design a reason.", image: "" }, { title: "Visual identity", body: "Logo, type, colour, imagery and a system to apply them.", image: "" }, { title: "Websites", body: "Design and build of marketing sites your team can update.", image: "" }, { title: "Campaigns", body: "Concepts and assets for launches and seasons.", image: "" }] }, "side"),
            sec("steps", { heading: "Process", subheading: "", items: [{ title: "Listen", body: "Workshops and interviews." }, { title: "Explore", body: "Directions, not just options." }, { title: "Refine", body: "One direction, crafted to detail." }, { title: "Handover", body: "Files, guidelines and support." }] }, "numbered"),
          ],
        },
        {
          path: "/studio",
          title: "Studio",
          description: `About ${name}.`,
          sections: [
            pageHero("Studio", "Small by design", `[Replace with your story] ${name} is an independent studio — we keep teams small so the people you meet are the people who do the work.`, "1524758631624-e2822e304c36", "Office lounge with designer furniture"),
            teamPlaceholders("The people"),
          ],
        },
        contactPage(name, "Start a project", "A few lines about what you need, your timeline and budget range is perfect.", "Brand identity, Website, Campaign, Something else"),
      ],
    }),
  },

  // Personal portfolio for a designer or developer.
  "personal-portfolio": {
    id: "personal-portfolio",
    personality: "minimal",
    palette: "obsidian",
    fontPair: "tech",
    ui: { header: "glass", headingWeight: 600, headingSpacing: -0.04 },
    build: (name) => ({
      nav: [{ label: "Work", href: "/#work" }, { label: "About", href: "/about" }, { label: "Experience", href: "/experience" }, { label: "Contact", href: "/contact" }],
      cta: { label: "Hire me", href: "/contact" },
      pages: [
        {
          path: "/",
          title: "Home",
          description: `${name} — product designer and front-end developer.`,
          sections: [
            sec("hero", { eyebrow: "[Your role] · [City]", heading: `Hi, I'm ${name}. I design and build thoughtful digital products.`, subheading: "[One or two lines about what you do best and who you do it for.]", primaryLabel: "See my work", primaryHref: "/#work", secondaryLabel: "Get in touch", secondaryHref: "/contact", image: "", imageAlt: "" }, "minimal", { decor: "glow" }),
            sec("gallery", { heading: "Selected work", images: [["1551650975-87deedd944c3", "[Project] — mobile app"], ["1460925895917-afdab827c52f", "[Project] — analytics dashboard"], ["1563986768609-322da13575f3", "[Project] — product design"], ["1498050108023-c5249f4df085", "[Project] — engineering"]].map(([id, alt]) => ({ src: img(id, 1400), alt })) }, "grid", { adv: { anchor: "work" } }),
            sec("features", { heading: "What I do", subheading: "", items: [{ icon: "palette", title: "Product design", body: "Research, flows, interface design and prototypes." }, { icon: "code", title: "Front-end development", body: "Accessible, fast interfaces built with modern frameworks." }, { icon: "layers", title: "Design systems", body: "Components and guidelines that keep teams consistent." }] }, "cards"),
            quotePlaceholders(),
            sec("cta", { heading: "Let's build something together.", body: "[Available for freelance projects from Month Year.]", buttonLabel: "Get in touch", buttonHref: "/contact" }, "card"),
          ],
        },
        {
          path: "/about",
          title: "About",
          description: `About ${name}.`,
          sections: [
            pageHero("About", `About ${name}`, "[A short, human introduction — how you got here and what you care about.]", "1501504905252-473c47e087f8", "Laptop, notebook and coffee on a desk"),
            sec("text", { heading: "How I work", body: "[Describe your approach in two or three short paragraphs. Specifics beat superlatives.]" }, "lead"),
            sec("features", { heading: "Toolkit", subheading: "[Edit to match the tools you use.]", items: [{ icon: "palette", title: "Design", body: "[Figma, prototyping, user research]" }, { icon: "code", title: "Development", body: "[TypeScript, React, CSS]" }, { icon: "chart", title: "Product", body: "[Analytics, experimentation, roadmaps]" }] }, "icons"),
          ],
        },
        {
          path: "/experience",
          title: "Experience",
          description: `Experience and background of ${name}.`,
          sections: [
            pageHero("Experience", "Where I've worked", "[Replace with your experience. Link your full résumé below.]"),
            sec("timeline", { heading: "", subheading: "", items: [{ date: "[Year – Present]", title: "[Role] at [Company]", body: "[What you owned and what changed because of it.]" }, { date: "[Year – Year]", title: "[Role] at [Company]", body: "[Key projects and outcomes.]" }, { date: "[Year – Year]", title: "[Role] at [Company]", body: "[Key projects and outcomes.]" }, { date: "[Year]", title: "[Degree], [Institution]", body: "" }] }, "vertical"),
            sec("cta", { heading: "Want the full résumé?", body: "", buttonLabel: "Request my CV", buttonHref: "/contact" }, "band"),
          ],
        },
        contactPage(name, "Get in touch", "Tell me about your project or role — I'll reply within two working days.", "Freelance project, Full-time role, Speaking, Just saying hi"),
      ],
    }),
  },
};
