// The site design document: the single source of truth for a website project.
// Stored as the project file SITE_DOC_PATH and shared by the visual builder,
// the IDE, preview rendering and deployment. Safe to import on client and server.
import { z } from "zod";
import { advSchema, elementsSchema, siteUiSchema } from "./advanced";
import { FONT_KEYS } from "./fonts";
import { EXTRA_SECTION_DEFS, EXTRA_VARIANTS } from "./sections-extra";
import { CONNECTED_SECTION_DEFS, CONNECTED_VARIANTS } from "./sections-connected";
import { ICON_NAMES } from "./icons";

export const SITE_DOC_PATH = "site/site.json";

export const BREAKPOINTS = ["desktop", "tablet", "mobile"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export const VIEWPORT_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 820, mobile: 390 };

// ─── Field registry (drives validation and the property panel) ───────────────

export type FieldDef =
  | { key: string; label: string; kind: "text" | "textarea" | "url" | "image"; placeholder?: string; max?: number }
  | { key: string; label: string; kind: "number"; min?: number; max?: number }
  | { key: string; label: string; kind: "boolean" }
  | { key: string; label: string; kind: "icon" }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: "list"; itemLabel: string; fields: FieldDef[]; maxItems?: number }
  | { key: string; label: string; kind: "strings"; itemLabel: string; maxItems?: number };

export type SectionDef = {
  type: string;
  label: string;
  description: string;
  category: "Structure" | "Content" | "Commerce" | "Conversion";
  fields: FieldDef[];
  defaults: () => Record<string, unknown>;
  /** Layout variants; the first is the default. */
  variants?: { value: string; label: string }[];
};

// Free-form sections place elements on a grid (columns × rows) per breakpoint.
export const FREEFORM_COLS = 12;
export const FREEFORM_MOBILE_COLS = 4;
export const FREEFORM_MAX_ROWS = 60;
export const FREEFORM_MAX_ITEMS = 24;
export const FREEFORM_KINDS = ["heading", "text", "image", "button", "shape"] as const;

const link: FieldDef[] = [
  { key: "label", label: "Label", kind: "text", max: 60 },
  { key: "href", label: "Link", kind: "url" },
];

export const SECTION_DEFS: SectionDef[] = [
  {
    type: "navbar",
    label: "Navigation",
    description: "Brand name, links and a call to action",
    category: "Structure",
    fields: [
      { key: "brand", label: "Brand", kind: "text", max: 60 },
      { key: "logo", label: "Logo image", kind: "image" },
      { key: "links", label: "Links", kind: "list", itemLabel: "Link", fields: link, maxItems: 8 },
      { key: "ctaLabel", label: "Button label", kind: "text", max: 40 },
      { key: "ctaHref", label: "Button link", kind: "url" },
      { key: "showCart", label: "Show cart link (online store)", kind: "boolean" },
    ],
    defaults: () => ({ brand: "Brand", links: [{ label: "Home", href: "/" }], ctaLabel: "", ctaHref: "", showCart: false }),
  },
  {
    type: "hero",
    label: "Hero",
    description: "Headline, supporting text and primary actions",
    category: "Structure",
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text", max: 80 },
      { key: "heading", label: "Heading", kind: "text", max: 140 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 400 },
      { key: "primaryLabel", label: "Primary button", kind: "text", max: 40 },
      { key: "primaryHref", label: "Primary link", kind: "url" },
      { key: "secondaryLabel", label: "Secondary button", kind: "text", max: 40 },
      { key: "secondaryHref", label: "Secondary link", kind: "url" },
      { key: "image", label: "Image URL", kind: "image" },
      { key: "imageAlt", label: "Image description", kind: "text", max: 160 },
      {
        key: "layout",
        label: "Layout",
        kind: "select",
        options: [
          { value: "centered", label: "Centered" },
          { value: "split", label: "Split with image" },
        ],
      },
    ],
    defaults: () => ({
      eyebrow: "",
      heading: "A clear headline that says what you do",
      subheading: "One or two sentences that explain who it is for and why it matters.",
      primaryLabel: "Get started",
      primaryHref: "#contact",
      secondaryLabel: "",
      secondaryHref: "",
      image: "",
      imageAlt: "",
      layout: "centered",
    }),
  },
  {
    type: "features",
    label: "Feature grid",
    description: "A grid of short benefit statements",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "items",
        label: "Items",
        kind: "list",
        itemLabel: "Feature",
        maxItems: 12,
        fields: [
          { key: "icon", label: "Icon", kind: "icon" },
          { key: "title", label: "Title", kind: "text", max: 80 },
          { key: "body", label: "Description", kind: "textarea", max: 300 },
        ],
      },
    ],
    defaults: () => ({
      heading: "Why people choose us",
      subheading: "",
      items: [
        { icon: "sparkles", title: "First benefit", body: "Describe the outcome, not the feature." },
        { icon: "shield", title: "Second benefit", body: "Keep each point short and specific." },
        { icon: "clock", title: "Third benefit", body: "Three to six items read best." },
      ],
    }),
  },
  {
    type: "text",
    label: "Text block",
    description: "A heading with paragraphs",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Body (blank line between paragraphs)", kind: "textarea", max: 5000 },
    ],
    defaults: () => ({ heading: "About us", body: "Tell your story in a few short paragraphs." }),
  },
  {
    type: "menu",
    label: "Menu / price list",
    description: "Categorised items with prices",
    category: "Commerce",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      { key: "currency", label: "Currency symbol", kind: "text", max: 4 },
      {
        key: "categories",
        label: "Categories",
        kind: "list",
        itemLabel: "Category",
        maxItems: 12,
        fields: [
          { key: "name", label: "Name", kind: "text", max: 60 },
          {
            key: "items",
            label: "Items",
            kind: "list",
            itemLabel: "Item",
            maxItems: 40,
            fields: [
              { key: "name", label: "Name", kind: "text", max: 80 },
              { key: "description", label: "Description", kind: "text", max: 200 },
              { key: "price", label: "Price", kind: "text", max: 20 },
            ],
          },
        ],
      },
    ],
    defaults: () => ({
      heading: "Menu",
      subheading: "",
      currency: "₹",
      categories: [{ name: "Category", items: [{ name: "Item name", description: "Short description", price: "0" }] }],
    }),
  },
  {
    type: "gallery",
    label: "Gallery",
    description: "A responsive grid of images",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      {
        key: "images",
        label: "Images",
        kind: "list",
        itemLabel: "Image",
        maxItems: 24,
        fields: [
          { key: "src", label: "Image URL", kind: "image" },
          { key: "alt", label: "Description", kind: "text", max: 160 },
        ],
      },
    ],
    defaults: () => ({ heading: "Gallery", images: [] }),
  },
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Quotes from real customers",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      {
        key: "items",
        label: "Quotes",
        kind: "list",
        itemLabel: "Quote",
        maxItems: 12,
        fields: [
          { key: "quote", label: "Quote", kind: "textarea", max: 500 },
          { key: "author", label: "Name", kind: "text", max: 80 },
          { key: "role", label: "Context", kind: "text", max: 80 },
        ],
      },
    ],
    defaults: () => ({
      heading: "What customers say",
      items: [{ quote: "[Replace with a real customer quote]", author: "[Customer name]", role: "" }],
    }),
  },
  {
    type: "pricing",
    label: "Pricing",
    description: "Plans with features and a call to action",
    category: "Commerce",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "plans",
        label: "Plans",
        kind: "list",
        itemLabel: "Plan",
        maxItems: 4,
        fields: [
          { key: "name", label: "Name", kind: "text", max: 40 },
          { key: "price", label: "Price", kind: "text", max: 20 },
          { key: "period", label: "Period", kind: "text", max: 20 },
          { key: "features", label: "Features", kind: "strings", itemLabel: "Feature", maxItems: 12 },
          { key: "ctaLabel", label: "Button label", kind: "text", max: 40 },
          { key: "ctaHref", label: "Button link", kind: "url" },
          { key: "highlighted", label: "Highlight this plan", kind: "boolean" },
        ],
      },
    ],
    defaults: () => ({
      heading: "Simple pricing",
      subheading: "",
      plans: [
        { name: "Basic", price: "₹999", period: "/month", features: ["Feature one"], ctaLabel: "Choose", ctaHref: "#contact", highlighted: false },
        { name: "Pro", price: "₹2,499", period: "/month", features: ["Everything in Basic", "Feature two"], ctaLabel: "Choose", ctaHref: "#contact", highlighted: true },
      ],
    }),
  },
  {
    type: "faq",
    label: "FAQ",
    description: "Questions and answers",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      {
        key: "items",
        label: "Questions",
        kind: "list",
        itemLabel: "Question",
        maxItems: 20,
        fields: [
          { key: "question", label: "Question", kind: "text", max: 200 },
          { key: "answer", label: "Answer", kind: "textarea", max: 1000 },
        ],
      },
    ],
    defaults: () => ({ heading: "Frequently asked questions", items: [{ question: "A common question?", answer: "A clear, direct answer." }] }),
  },
  {
    type: "cta",
    label: "Call to action",
    description: "A focused band with one action",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 300 },
      { key: "buttonLabel", label: "Button label", kind: "text", max: 40 },
      { key: "buttonHref", label: "Button link", kind: "url" },
    ],
    defaults: () => ({ heading: "Ready to get started?", body: "", buttonLabel: "Contact us", buttonHref: "#contact" }),
  },
  {
    type: "contact",
    label: "Contact",
    description: "Contact details, WhatsApp and an enquiry form",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 400 },
      { key: "email", label: "Email", kind: "text", max: 120 },
      { key: "phone", label: "Phone", kind: "text", max: 40 },
      { key: "whatsapp", label: "WhatsApp number (international, digits only)", kind: "text", max: 20 },
      { key: "address", label: "Address", kind: "textarea", max: 300 },
      { key: "hours", label: "Opening hours", kind: "textarea", max: 300 },
      { key: "showForm", label: "Show enquiry form", kind: "boolean" },
    ],
    defaults: () => ({ heading: "Get in touch", body: "", email: "", phone: "", whatsapp: "", address: "", hours: "", showForm: true }),
  },
  {
    type: "booking",
    label: "Reservation / booking",
    description: "A booking request form stored as submissions",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 400 },
      { key: "maxPartySize", label: "Maximum party size", kind: "number", min: 1, max: 100 },
      { key: "buttonLabel", label: "Button label", kind: "text", max: 40 },
    ],
    defaults: () => ({ heading: "Book a table", body: "Send a request and we will confirm by phone or email.", maxPartySize: 10, buttonLabel: "Request booking" }),
  },
  {
    type: "banner",
    label: "Announcement bar",
    description: "A slim bar above the navigation",
    category: "Structure",
    fields: [
      { key: "text", label: "Text", kind: "text", max: 140 },
      { key: "linkLabel", label: "Link label", kind: "text", max: 40 },
      { key: "linkHref", label: "Link", kind: "url" },
    ],
    defaults: () => ({ text: "Now open for weekend brunch", linkLabel: "Learn more", linkHref: "#contact" }),
  },
  {
    type: "split",
    label: "Image + text",
    description: "A spotlight with a photo beside the story",
    category: "Content",
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text", max: 80 },
      { key: "heading", label: "Heading", kind: "text", max: 140 },
      { key: "body", label: "Body", kind: "textarea", max: 1500 },
      { key: "bullets", label: "Highlights", kind: "strings", itemLabel: "Highlight", maxItems: 6 },
      { key: "image", label: "Image URL", kind: "image" },
      { key: "imageAlt", label: "Image description", kind: "text", max: 160 },
      { key: "buttonLabel", label: "Button label", kind: "text", max: 40 },
      { key: "buttonHref", label: "Button link", kind: "url" },
    ],
    defaults: () => ({ eyebrow: "", heading: "A closer look", body: "Tell the story behind what you do.", bullets: [], image: "", imageAlt: "", buttonLabel: "", buttonHref: "" }),
  },
  {
    type: "stats",
    label: "Key figures",
    description: "Large numbers that build credibility",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "items",
        label: "Figures",
        kind: "list",
        itemLabel: "Figure",
        maxItems: 6,
        fields: [
          { key: "value", label: "Value", kind: "text", max: 20 },
          { key: "label", label: "Label", kind: "text", max: 80 },
        ],
      },
    ],
    defaults: () => ({ heading: "", subheading: "", items: [{ value: "10+", label: "Years in business" }, { value: "4.9", label: "Average rating" }, { value: "2k", label: "Happy customers" }], _example: true }),
  },
  {
    type: "steps",
    label: "How it works",
    description: "A numbered process",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "items",
        label: "Steps",
        kind: "list",
        itemLabel: "Step",
        maxItems: 8,
        fields: [
          { key: "title", label: "Title", kind: "text", max: 80 },
          { key: "body", label: "Description", kind: "textarea", max: 300 },
        ],
      },
    ],
    defaults: () => ({
      heading: "How it works",
      subheading: "",
      items: [
        { title: "Get in touch", body: "Tell us what you need." },
        { title: "We plan it together", body: "You get a clear plan and price." },
        { title: "Enjoy the result", body: "We deliver and stay in touch." },
      ],
    }),
  },
  {
    type: "team",
    label: "Team",
    description: "The people behind the business",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "members",
        label: "People",
        kind: "list",
        itemLabel: "Person",
        maxItems: 12,
        fields: [
          { key: "name", label: "Name", kind: "text", max: 80 },
          { key: "role", label: "Role", kind: "text", max: 80 },
          { key: "photo", label: "Photo URL", kind: "image" },
          { key: "bio", label: "Short bio", kind: "textarea", max: 300 },
        ],
      },
    ],
    defaults: () => ({ heading: "Meet the team", subheading: "", members: [{ name: "Your name", role: "Founder", photo: "", bio: "" }, { name: "Team member", role: "Role", photo: "", bio: "" }, { name: "Team member", role: "Role", photo: "", bio: "" }], _example: true }),
  },
  {
    type: "logos",
    label: "Logo strip",
    description: "Clients, partners or press — names shown as wordmarks",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "items", label: "Names", kind: "list", itemLabel: "Name", maxItems: 10, fields: [{ key: "name", label: "Name", kind: "text", max: 40 }] },
    ],
    defaults: () => ({ heading: "Trusted by teams at", items: [{ name: "Northwind" }, { name: "Acme" }, { name: "Globex" }, { name: "Initech" }, { name: "Umbrella" }], _example: true }),
  },
  {
    type: "newsletter",
    label: "Newsletter sign-up",
    description: "Collect email addresses",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 300 },
      { key: "buttonLabel", label: "Button label", kind: "text", max: 40 },
    ],
    defaults: () => ({ heading: "Stay in the loop", body: "News and offers, once a month. Unsubscribe anytime.", buttonLabel: "Subscribe" }),
  },
  {
    type: "productGrid",
    label: "Product grid (store)",
    description: "Live products from your store catalog",
    category: "Commerce",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      { key: "collection", label: "Collection handle (blank = all products)", kind: "text", max: 80 },
      {
        key: "sort",
        label: "Order",
        kind: "select",
        options: [
          { value: "featured", label: "Featured first" },
          { value: "newest", label: "Newest" },
          { value: "price-asc", label: "Price: low to high" },
          { value: "price-desc", label: "Price: high to low" },
        ],
      },
      { key: "limit", label: "Number of products", kind: "number", min: 1, max: 24 },
      { key: "buttonLabel", label: "“View all” button label", kind: "text", max: 40 },
    ],
    defaults: () => ({ heading: "Shop bestsellers", subheading: "", collection: "", sort: "featured", limit: 8, buttonLabel: "View all" }),
  },
  {
    type: "dataList",
    label: "Data list",
    description: "Live rows from one of your data tables",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      { key: "table", label: "Table (API name)", kind: "text", max: 40, placeholder: "team-members" },
      { key: "titleField", label: "Title field key", kind: "text", max: 48 },
      { key: "fields", label: "Other fields to show (keys)", kind: "strings", itemLabel: "Field key", maxItems: 8 },
      { key: "imageField", label: "Image field key (optional)", kind: "text", max: 48 },
      { key: "linkField", label: "Link field key (optional)", kind: "text", max: 48 },
      { key: "filter", label: "Only rows where (e.g. status=Published, price<100)", kind: "text", max: 200 },
      { key: "sort", label: "Sort by key (prefix - for descending)", kind: "text", max: 60 },
      { key: "limit", label: "Number of rows", kind: "number", min: 1, max: 48 },
      { key: "emptyText", label: "Text when there are no rows", kind: "text", max: 200 },
    ],
    defaults: () => ({ heading: "Directory", subheading: "", table: "", titleField: "", fields: [], imageField: "", linkField: "", filter: "", sort: "", limit: 12, emptyText: "" }),
  },
  {
    type: "collectionList",
    label: "Collections (store)",
    description: "Tiles linking to your store collections",
    category: "Commerce",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "limit", label: "Number of collections", kind: "number", min: 1, max: 12 },
    ],
    defaults: () => ({ heading: "Shop by category", limit: 6 }),
  },
  {
    type: "posts",
    label: "Blog posts",
    description: "Latest posts from your blog, newest first",
    category: "Content",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      { key: "limit", label: "Number of posts", kind: "number", min: 1, max: 24 },
    ],
    defaults: () => ({ heading: "From the journal", subheading: "", limit: 3 }),
  },
  {
    type: "article",
    label: "Article",
    description: "Long-form text with headings, lists and links",
    category: "Content",
    fields: [{ key: "body", label: "Text (## heading, - list, **bold**, *italic*, [link](url))", kind: "textarea", max: 20000 }],
    defaults: () => ({ body: "Start writing here.\n\n## A section heading\n\nParagraphs are separated by a blank line.\n\n- Lists start with a dash\n- **Bold** and *italic* work too" }),
  },
  {
    type: "products",
    label: "Products",
    description: "Product cards with prices and buy links",
    category: "Commerce",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Supporting text", kind: "textarea", max: 300 },
      {
        key: "items",
        label: "Products",
        kind: "list",
        itemLabel: "Product",
        maxItems: 24,
        fields: [
          { key: "image", label: "Image", kind: "image" },
          { key: "name", label: "Name", kind: "text", max: 80 },
          { key: "price", label: "Price", kind: "text", max: 20 },
          { key: "description", label: "Description", kind: "text", max: 200 },
          { key: "badge", label: "Badge (e.g. New)", kind: "text", max: 20 },
          { key: "buttonLabel", label: "Button label", kind: "text", max: 30 },
          { key: "buttonHref", label: "Buy link (payment link or page)", kind: "url" },
        ],
      },
    ],
    defaults: () => ({ heading: "Shop the collection", subheading: "", items: [{ image: "", name: "Product name", price: "₹1,499", description: "Short description", badge: "", buttonLabel: "Buy now", buttonHref: "" }] }),
  },
  {
    type: "map",
    label: "Map",
    description: "An embedded map of your address",
    category: "Conversion",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "address", label: "Address or place name", kind: "textarea", max: 300 },
      { key: "zoom", label: "Zoom (1–20)", kind: "number", min: 1, max: 20 },
    ],
    defaults: () => ({ heading: "Find us", address: "", zoom: 15 }),
  },
  {
    type: "freeform",
    label: "Free-form",
    description: "Place text, images and buttons anywhere on a grid",
    category: "Content",
    fields: [
      { key: "rows", label: "Height (grid rows)", kind: "number", min: 2, max: FREEFORM_MAX_ROWS },
      {
        key: "mobile",
        label: "On phones",
        kind: "select",
        options: [
          { value: "stack", label: "Stack in reading order" },
          { value: "custom", label: "Use my phone layout" },
        ],
      },
      {
        key: "items",
        label: "Elements",
        kind: "list",
        itemLabel: "Element",
        maxItems: FREEFORM_MAX_ITEMS,
        fields: [
          { key: "kind", label: "Type", kind: "select", options: FREEFORM_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })) },
          { key: "text", label: "Text", kind: "textarea", max: 600 },
          { key: "image", label: "Image", kind: "image" },
          { key: "alt", label: "Image description", kind: "text", max: 200 },
          { key: "href", label: "Link", kind: "url" },
          {
            key: "tone",
            label: "Colour",
            kind: "select",
            options: [
              { value: "plain", label: "Plain" },
              { value: "surface", label: "Soft panel" },
              { value: "accent", label: "Accent" },
              { value: "inverse", label: "Dark" },
            ],
          },
          {
            key: "size",
            label: "Text size",
            kind: "select",
            options: [
              { value: "sm", label: "Small" },
              { value: "md", label: "Medium" },
              { value: "lg", label: "Large" },
              { value: "xl", label: "Huge" },
            ],
          },
          {
            key: "align",
            label: "Alignment",
            kind: "select",
            options: [
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
              { value: "right", label: "Right" },
            ],
          },
          { key: "x", label: "Column (desktop)", kind: "number", min: 0, max: FREEFORM_COLS - 1 },
          { key: "y", label: "Row (desktop)", kind: "number", min: 0, max: FREEFORM_MAX_ROWS - 1 },
          { key: "w", label: "Width in columns (desktop)", kind: "number", min: 1, max: FREEFORM_COLS },
          { key: "h", label: "Height in rows (desktop)", kind: "number", min: 1, max: FREEFORM_MAX_ROWS },
          { key: "mx", label: "Column (phone)", kind: "number", min: 0, max: FREEFORM_MOBILE_COLS - 1 },
          { key: "my", label: "Row (phone)", kind: "number", min: 0, max: FREEFORM_MAX_ROWS - 1 },
          { key: "mw", label: "Width in columns (phone)", kind: "number", min: 1, max: FREEFORM_MOBILE_COLS },
          { key: "mh", label: "Height in rows (phone)", kind: "number", min: 1, max: FREEFORM_MAX_ROWS },
        ],
      },
    ],
    defaults: () => ({
      rows: 10,
      mobile: "stack",
      items: [
        { kind: "shape", tone: "surface", x: 0, y: 0, w: 7, h: 10 },
        { kind: "heading", text: "Make it yours", size: "xl", align: "left", tone: "plain", x: 1, y: 1, w: 6, h: 3 },
        { kind: "text", text: "Drag elements anywhere. Layers overlap, and each one snaps to the grid so the page stays tidy on every screen.", size: "md", align: "left", tone: "plain", x: 1, y: 4, w: 5, h: 3 },
        { kind: "button", text: "Get in touch", href: "/contact", tone: "accent", align: "left", x: 1, y: 7, w: 3, h: 2 },
        { kind: "image", image: "", alt: "", x: 6, y: 2, w: 6, h: 8 },
      ],
      _example: true,
    }),
  },
  {
    type: "footer",
    label: "Footer",
    description: "Closing links and legal text",
    category: "Structure",
    fields: [
      { key: "text", label: "Text", kind: "text", max: 200 },
      { key: "links", label: "Links", kind: "list", itemLabel: "Link", fields: link, maxItems: 10 },
    ],
    defaults: () => ({ text: "© Your business", links: [] }),
  },
];

const VARIANTS: Record<string, { value: string; label: string }[]> = {
  navbar: [
    { value: "classic", label: "Classic" },
    { value: "centered", label: "Centered logo" },
    { value: "floating", label: "Floating pill" },
  ],
  hero: [
    { value: "centered", label: "Centered" },
    { value: "split", label: "Split with image" },
    { value: "overlay", label: "Full-bleed photo" },
    { value: "editorial", label: "Editorial headline" },
    { value: "minimal", label: "Minimal" },
  ],
  features: [
    { value: "cards", label: "Cards" },
    { value: "icons", label: "Icon list" },
    { value: "bento", label: "Bento grid" },
    { value: "numbered", label: "Numbered" },
  ],
  text: [
    { value: "standard", label: "Standard" },
    { value: "lead", label: "Large intro" },
    { value: "columns", label: "Heading beside text" },
  ],
  split: [
    { value: "image-left", label: "Image left" },
    { value: "image-right", label: "Image right" },
  ],
  stats: [
    { value: "row", label: "Row" },
    { value: "cards", label: "Cards" },
  ],
  steps: [
    { value: "numbered", label: "Numbered columns" },
    { value: "timeline", label: "Timeline" },
  ],
  team: [
    { value: "grid", label: "Grid" },
    { value: "list", label: "List with bios" },
  ],
  menu: [
    { value: "list", label: "Dotted list" },
    { value: "cards", label: "Cards" },
  ],
  gallery: [
    { value: "grid", label: "Grid" },
    { value: "masonry", label: "Masonry" },
    { value: "carousel", label: "Scrolling strip" },
  ],
  testimonials: [
    { value: "grid", label: "Grid" },
    { value: "spotlight", label: "Single spotlight" },
    { value: "carousel", label: "Swipe carousel" },
  ],
  logos: [
    { value: "row", label: "Row" },
    { value: "marquee", label: "Scrolling" },
  ],
  ...EXTRA_VARIANTS,
  ...CONNECTED_VARIANTS,
  pricing: [
    { value: "cards", label: "Cards" },
    { value: "minimal", label: "Minimal" },
  ],
  faq: [
    { value: "list", label: "List" },
    { value: "split", label: "Heading beside questions" },
  ],
  cta: [
    { value: "band", label: "Band" },
    { value: "card", label: "Floating card" },
  ],
  contact: [
    { value: "split", label: "Details beside form" },
    { value: "centered", label: "Centered" },
  ],
  booking: [
    { value: "form", label: "Form" },
    { value: "card", label: "Card" },
  ],
  newsletter: [
    { value: "inline", label: "Inline" },
    { value: "card", label: "Card" },
  ],
  dataList: [
    { value: "cards", label: "Cards" },
    { value: "table", label: "Table" },
    { value: "list", label: "List" },
  ],
  productGrid: [
    { value: "grid", label: "Grid" },
    { value: "carousel", label: "Scrolling row" },
    { value: "editorial", label: "Editorial (large first)" },
  ],
  collectionList: [
    { value: "tiles", label: "Image tiles" },
    { value: "minimal", label: "Minimal list" },
  ],
  posts: [
    { value: "cards", label: "Cards" },
    { value: "list", label: "List" },
  ],
  products: [
    { value: "grid", label: "Grid" },
    { value: "showcase", label: "Large showcase" },
  ],
  map: [
    { value: "wide", label: "Full width" },
    { value: "split", label: "Beside address" },
  ],
  footer: [
    { value: "simple", label: "Simple" },
    { value: "columns", label: "With columns" },
  ],
};
SECTION_DEFS.splice(SECTION_DEFS.findIndex((d) => d.type === "footer"), 0, ...EXTRA_SECTION_DEFS, ...CONNECTED_SECTION_DEFS);
for (const d of SECTION_DEFS) d.variants = VARIANTS[d.type] ?? [{ value: "default", label: "Default" }];

export const SECTION_TYPES = SECTION_DEFS.map((d) => d.type) as [string, ...string[]];
export const sectionDef = (type: string) => SECTION_DEFS.find((d) => d.type === type);

// ─── Document schema ─────────────────────────────────────────────────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour");

export const themeSchema = z.object({
  palette: z.object({
    background: hex,
    surface: hex,
    text: hex,
    muted: hex,
    accent: hex,
    accentText: hex,
  }),
  font: z.enum(FONT_KEYS),
  headingFont: z.enum(FONT_KEYS),
  radius: z.enum(["none", "sm", "md", "lg"]),
  density: z.enum(["compact", "comfortable", "airy"]),
  buttonStyle: z.enum(["solid", "pill", "outline", "sharp"]).default("solid"),
  typeScale: z.enum(["compact", "balanced", "dramatic"]).default("balanced"),
  motion: z.enum(["none", "subtle", "expressive"]).default("subtle"),
  /** "glass": translucent, frosted cards and bars over soft colour light. */
  surface: z.enum(["solid", "glass"]).optional(),
  /** Design direction the theme was generated from (informational). */
  personality: z.string().max(40).optional(),
  /** Site-wide interface settings: header behaviour, container, buttons, spacing. */
  ui: siteUiSchema.optional(),
});

export const DECORATIONS = ["none", "gradient", "mesh", "glow", "grid", "dots", "grain"] as const;

const responsiveSchema = z.object({
  align: z.enum(["left", "center"]).optional(),
  paddingY: z.enum(["sm", "md", "lg"]).optional(),
  textScale: z.enum(["sm", "md", "lg"]).optional(),
});

export const sectionStyleSchema = z.object({
  background: z.enum(["default", "surface", "accent", "inverse"]).default("default"),
  align: z.enum(["left", "center"]).default("left"),
  paddingY: z.enum(["sm", "md", "lg"]).default("md"),
  hideOn: z.array(z.enum(BREAKPOINTS)).default([]),
  decor: z.enum(DECORATIONS).default("none"),
  textScale: z.enum(["sm", "md", "lg"]).default("md"),
  /** Tablet and mobile overrides; unset values inherit from desktop. */
  overrides: z.object({ tablet: responsiveSchema.optional(), mobile: responsiveSchema.optional() }).optional(),
  /** Per-section motion; "theme" follows the site's motion setting. */
  motion: z
    .object({
      entrance: z.enum(["theme", "none", "fade", "up", "zoom", "left", "right", "blur"]).default("theme"),
      speed: z.enum(["slow", "normal", "fast"]).default("normal"),
      stagger: z.boolean().default(true),
      hover: z.enum(["none", "lift", "glow", "scale"]).default("none"),
      parallax: z.boolean().default(false),
    })
    .optional(),
  // Grid columns per breakpoint for multi-item sections.
  columns: z
    .object({ desktop: z.number().int().min(1).max(4), tablet: z.number().int().min(1).max(3), mobile: z.number().int().min(1).max(2) })
    .optional(),
  /** Advanced design: custom background, colours, type, spacing, cards, dividers, anchor, CSS. */
  adv: advSchema.optional(),
  /** Per-element styles keyed by field path (e.g. "heading", "items.0.title"). */
  elements: elementsSchema.optional(),
});

export const sectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(SECTION_TYPES),
  variant: z.string().max(40).optional(),
  /** A/B test: visitors in group B see this layout variant instead. */
  ab: z
    .object({
      /** Layout variant for group B ("" keeps the current one). */
      variant: z.string().max(40),
      running: z.boolean(),
      /** Content overrides for group B (e.g. a different headline). */
      props: z.record(z.string(), z.unknown()).optional(),
      /** Set when the growth autopilot owns the test; keeps its numbers separate from earlier tests. */
      experimentId: z.string().max(64).optional(),
    })
    .optional(),
  props: z.record(z.string(), z.unknown()),
  /** Instance of a global component: every section with this id shares content and design. */
  globalId: z.string().regex(/^g_[a-z0-9]{4,24}$/).optional(),
  style: sectionStyleSchema.default({ background: "default", align: "left", paddingY: "md", hideOn: [], decor: "none", textScale: "md" }),
});

export const pageSchema = z.object({
  id: z.string().min(1).max(64),
  path: z
    .string()
    .regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, "Paths are lowercase letters, numbers and dashes, starting with /"),
  title: z.string().min(1).max(120),
  description: z.string().max(300).default(""),
  kind: z.enum(["page", "post"]).default("page"),
  /** Overrides the site language for this page (translations). */
  lang: z.string().min(2).max(10).optional(),
  /** Id of the page this one translates. */
  translationOf: z.string().max(64).optional(),
  needsTranslation: z.boolean().optional(),
  /** Only signed-in members with an active membership can see this page. */
  membersOnly: z.boolean().optional(),
  /** Search engine controls for this page. */
  seo: z
    .object({
      /** The page's preferred address when the same content lives at more than one (absolute https). */
      canonical: z.string().trim().max(500).regex(/^https:\/\/[^\s"<>]+$/, "Use a full https:// address").optional(),
      /** Ask search engines not to list this page. */
      noindex: z.boolean().optional(),
    })
    .optional(),
  meta: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), author: z.string().max(80).optional(), image: z.string().max(500).optional() })
    .optional(),
  sections: z.array(sectionSchema).max(60),
});

export const siteDocSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    lang: z.string().min(2).max(10).default("en"),
    theme: themeSchema,
    brand: z.object({ logo: z.string().max(500).optional(), colors: z.array(z.string()).max(12).optional(), source: z.string().max(200).optional() }).optional(),
    pages: z.array(pageSchema).min(1).max(200),
    /** Site-wide search and sharing settings. */
    seo: z
      .object({
        /** The little icon in the browser tab. */
        favicon: z.string().max(500).optional(),
        /** Search Console / Bing Webmaster verification codes (the content of their meta tag). */
        googleVerify: z.string().trim().max(120).regex(/^[A-Za-z0-9_-]*$/, "Paste only the code").optional(),
        bingVerify: z.string().trim().max(120).regex(/^[A-Za-z0-9_-]*$/, "Paste only the code").optional(),
        /** Structured data about the business, for richer search results. */
        org: z
          .object({
            type: z.enum(["Organization", "LocalBusiness", "Restaurant", "Store", "MedicalClinic", "School"]).default("Organization"),
            phone: z.string().trim().max(40).optional(),
            email: z.string().trim().max(200).optional(),
            address: z.string().trim().max(300).optional(),
            sameAs: z.array(z.string().trim().max(300).regex(/^https:\/\//)).max(10).default([]),
          })
          .optional(),
      })
      .optional(),
    /** Names of global components (reusable sections kept in sync across pages). */
    globals: z.array(z.object({ id: z.string().regex(/^g_[a-z0-9]{4,24}$/), name: z.string().trim().min(1).max(60) })).max(50).optional(),
  })
  .superRefine((doc, ctx) => {
    const paths = new Set<string>();
    const ids = new Set<string>();
    doc.pages.forEach((p, i) => {
      if (paths.has(p.path)) ctx.addIssue({ code: "custom", path: ["pages", i, "path"], message: `Duplicate page path ${p.path}` });
      paths.add(p.path);
      for (const s of p.sections) {
        if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: ["pages", i], message: `Duplicate section id ${s.id}` });
        ids.add(s.id);
      }
    });
    if (!paths.has("/")) ctx.addIssue({ code: "custom", path: ["pages"], message: "The site needs a home page at /" });
  });

export type SiteTheme = z.infer<typeof themeSchema>;
export type SectionStyle = z.infer<typeof sectionStyleSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Page = z.infer<typeof pageSchema>;
export type SiteDoc = z.infer<typeof siteDocSchema>;

export function parseSiteDoc(json: string): { ok: true; doc: SiteDoc } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  const r = siteDocSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  return { ok: true, doc: r.data };
}

export function serializeSiteDoc(doc: SiteDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

export function newId(prefix = "s"): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${rnd.replace(/-/g, "").slice(0, 10)}`;
}

export const ICON_OPTIONS = ICON_NAMES;

export function variantOf(s: Section): string {
  const def = sectionDef(s.type);
  return s.variant && def?.variants?.some((v) => v.value === s.variant) ? s.variant : (def?.variants?.[0]?.value ?? "default");
}

export function createSection(type: string): Section {
  const def = sectionDef(type);
  if (!def) throw new Error(`Unknown section type ${type}`);
  return {
    id: newId(),
    type: def.type,
    variant: def.variants?.[0]?.value,
    props: def.defaults(),
    style: { background: "default", align: type === "hero" || type === "cta" || type === "newsletter" ? "center" : "left", paddingY: "md", hideOn: [], decor: "none", textScale: "md" },
  };
}

export const THEME_PRESETS: Record<string, { label: string; theme: SiteTheme }> = {
  minimal: {
    label: "Minimal",
    theme: {
      palette: { background: "#ffffff", surface: "#f5f5f4", text: "#1c1917", muted: "#57534e", accent: "#1c1917", accentText: "#ffffff" },
      font: "sans",
      headingFont: "sans",
      radius: "md",
      density: "comfortable",
      buttonStyle: "solid",
      typeScale: "balanced",
      motion: "subtle",
    },
  },
  warm: {
    label: "Warm hospitality",
    theme: {
      palette: { background: "#fbf8f3", surface: "#f1ebe1", text: "#2a211b", muted: "#6b5d52", accent: "#8a3b12", accentText: "#ffffff" },
      font: "sans",
      headingFont: "serif",
      radius: "sm",
      density: "airy",
      buttonStyle: "solid",
      typeScale: "balanced",
      motion: "subtle",
    },
  },
  midnight: {
    label: "Midnight",
    theme: {
      palette: { background: "#0c0d10", surface: "#16181d", text: "#f3f4f6", muted: "#a1a1aa", accent: "#e8d5a8", accentText: "#14120d" },
      font: "sans",
      headingFont: "serif",
      radius: "sm",
      density: "airy",
      buttonStyle: "solid",
      typeScale: "balanced",
      motion: "subtle",
    },
  },
  fresh: {
    label: "Fresh",
    theme: {
      palette: { background: "#ffffff", surface: "#f0f7f4", text: "#10221b", muted: "#4b635a", accent: "#0f766e", accentText: "#ffffff" },
      font: "rounded",
      headingFont: "rounded",
      radius: "lg",
      density: "comfortable",
      buttonStyle: "solid",
      typeScale: "balanced",
      motion: "subtle",
    },
  },
  studio: {
    label: "Studio",
    theme: {
      palette: { background: "#f7f7f5", surface: "#ecebe7", text: "#111111", muted: "#5c5c58", accent: "#2747d6", accentText: "#ffffff" },
      font: "sans",
      headingFont: "sans",
      radius: "none",
      density: "airy",
      buttonStyle: "solid",
      typeScale: "balanced",
      motion: "subtle",
    },
  },
};
