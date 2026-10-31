// Starter templates. Each one is a brief run through the same planner and
// composer as a user's own description, so importing a template creates real,
// editable project files — not a link to an empty editor.
import { PERSONALITIES } from "./design";
import { composeSite, planFromBrief } from "./planner";
import { photoUrl } from "./media";
import { CRAFTED, craftedSiteDoc } from "./crafted";
import type { SiteDoc } from "./model";
import type { ProjectSpec } from "./spec";

export type Template = {
  id: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  requiredIntegrations: string[];
  brief: string;
  defaultName: string;
  /** A crafted multi-page site (see crafted.ts) instead of one composed from the brief. */
  crafted?: string;
  /** Pages the crafted site comes with, for the template card. */
  pages?: string[];
  /** The design direction it starts in (see design.ts); otherwise picked from the brief. */
  personality?: string;
  /** Its own hero words, instead of the industry's defaults. */
  hero?: { eyebrow: string; heading: string; sub: string };
  /** Its own photos (Unsplash ids, checked by hand, with alt text), used in order across the page. */
  photos?: [string, string][];
};

export const TEMPLATES: Template[] = [
  // ── Premium: crafted multi-page sites ──
  {
    id: "tech-enterprise",
    name: "Enterprise IT services",
    category: "Technology",
    description: "Corporate-grade site for IT services and digital engineering firms: capabilities, industries, engagement models and careers.",
    features: ["7 pages", "Industries tabs", "Engagement models table", "Careers & hiring process"],
    requiredIntegrations: [],
    brief: "An enterprise IT services and digital engineering company website with services, industries, about, careers and contact",
    defaultName: "Vertex Systems",
    crafted: "tech-enterprise",
    pages: ["Home", "Services", "Industries", "About", "Careers", "Contact", "Privacy"],
  },
  {
    id: "saas-platform",
    name: "SaaS platform",
    category: "Technology",
    description: "Glass-modern product site with a feature grid, product tour, pricing comparison and a security page.",
    features: ["7 pages", "Pricing & plan comparison", "Security page", "Demo requests"],
    requiredIntegrations: [],
    brief: "A SaaS platform website with product tour, pricing plans, security, company and demo booking",
    defaultName: "Nimbus",
    crafted: "saas-platform",
    pages: ["Home", "Product", "Pricing", "Security", "Company", "Contact", "Privacy"],
  },
  {
    id: "ai-startup",
    name: "AI startup",
    category: "Technology",
    description: "Dark, high-contrast site for an AI company: platform, use cases, deployment options and early-access requests.",
    features: ["7 pages", "Use-case tabs", "Platform deep-dives", "Access requests"],
    requiredIntegrations: [],
    brief: "An applied AI startup website with platform, use cases, company, careers and access requests",
    defaultName: "Kinetic AI",
    crafted: "ai-startup",
    pages: ["Home", "Platform", "Use cases", "Company", "Careers", "Contact", "Privacy"],
  },
  {
    id: "marketing-agency",
    name: "Marketing agency",
    category: "Marketing",
    description: "Bold agency site with services, retainers, a case-study format, a clear process and proposal requests.",
    features: ["7 pages", "Retainer pricing", "Case-study gallery", "Process timeline"],
    requiredIntegrations: [],
    brief: "A digital marketing agency website with services, work, process, about and proposal requests",
    defaultName: "Amplify Growth",
    crafted: "marketing-agency",
    pages: ["Home", "Services", "Work", "Process", "About", "Contact", "Privacy"],
  },
  {
    id: "design-studio",
    name: "Design studio",
    category: "Marketing",
    description: "Editorial, gallery-led site for branding and design studios.",
    features: ["6 pages", "Masonry work gallery", "Services & process", "Project enquiries"],
    requiredIntegrations: [],
    brief: "A branding and design studio portfolio with work, services, studio and project enquiries",
    defaultName: "Lumina Studio",
    crafted: "design-studio",
    pages: ["Home", "Work", "Services", "Studio", "Contact", "Privacy"],
  },
  {
    id: "personal-portfolio",
    name: "Personal portfolio",
    category: "Portfolio",
    description: "Sleek dark portfolio for designers and developers: selected work, about, experience timeline and contact.",
    features: ["5 pages", "Work grid", "Experience timeline", "Hire-me form"],
    requiredIntegrations: [],
    brief: "A personal portfolio for a product designer and developer with work, about, experience and contact",
    defaultName: "Aarav Mehta",
    crafted: "personal-portfolio",
    pages: ["Home", "About", "Experience", "Contact", "Privacy"],
  },
  {
    id: "restaurant",
    name: "Restaurant",
    category: "Hospitality",
    description: "Menu, table reservations, WhatsApp contact and opening hours.",
    features: ["Menu with prices", "Reservation requests", "WhatsApp link", "Contact form"],
    requiredIntegrations: [],
    brief: "A restaurant website with menu, table reservations, customer reviews, WhatsApp contact and an about page",
    defaultName: "Saffron House",
  },
  {
    id: "saas",
    name: "SaaS landing page",
    category: "Software",
    description: "Product story, feature grid, pricing plans and FAQ.",
    features: ["Feature grid", "Pricing plans", "FAQ", "Contact form"],
    requiredIntegrations: [],
    brief: "A SaaS product landing page with features, pricing plans and FAQ",
    defaultName: "Northwind",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    category: "Personal",
    description: "Selected work gallery, services and an enquiry form.",
    features: ["Image gallery", "Services", "Contact form"],
    requiredIntegrations: [],
    brief: "A designer portfolio with a gallery of work, services and an about page",
    defaultName: "Studio Mira",
  },
  {
    id: "consulting",
    name: "Consulting firm",
    category: "Professional services",
    description: "Services, process, testimonials and appointment requests.",
    features: ["Services", "Testimonials", "Appointment requests", "FAQ"],
    requiredIntegrations: [],
    brief: "A consulting firm website with services, testimonials, FAQ and appointment booking",
    defaultName: "Meridian Advisory",
  },
  {
    id: "cafe",
    name: "Café & bakery",
    category: "Hospitality",
    description: "Menu, gallery, opening hours and a newsletter for regulars.",
    features: ["Menu", "Photo gallery", "Newsletter", "Contact & hours"],
    requiredIntegrations: [],
    brief: "A cosy specialty coffee shop and bakery with a menu, photo gallery, newsletter and opening hours",
    defaultName: "Ember & Oat",
  },
  {
    id: "spa",
    name: "Spa & wellness",
    category: "Wellness",
    description: "Treatments, first-visit steps and appointment requests in a calm, natural style.",
    features: ["Treatment highlights", "How it works", "Appointment requests", "Gallery"],
    requiredIntegrations: [],
    brief: "A luxury day spa and wellness studio with treatments, appointment booking and a gallery",
    defaultName: "Still Waters Spa",
  },
  {
    id: "fitness",
    name: "Gym & fitness",
    category: "Fitness",
    description: "Bold design with programmes, memberships and a free-trial call to action.",
    features: ["Programmes", "Memberships", "Key figures", "Trial sign-up"],
    requiredIntegrations: [],
    brief: "A bold strength and conditioning gym with coaching, memberships and a free trial",
    defaultName: "Forge Athletics",
  },
  {
    id: "realestate",
    name: "Real estate",
    category: "Property",
    description: "Featured homes, valuation requests and a clear selling process.",
    features: ["Property gallery", "Selling steps", "Valuation requests"],
    requiredIntegrations: [],
    brief: "A premium real estate agency for homes and apartments with featured properties and valuations",
    defaultName: "Harbour & Hill Estates",
  },
  {
    id: "store",
    name: "Product brand",
    category: "Retail",
    description: "A minimal storefront for a collection, with newsletter capture for launches.",
    features: ["Collection gallery", "Brand story", "Newsletter"],
    requiredIntegrations: [],
    brief: "A minimal brand store for a small collection of products with a newsletter",
    defaultName: "Kōbo Goods",
  },
  {
    id: "app",
    name: "App launch",
    category: "Software",
    description: "An Apple-style glass launch page with features, setup steps and early-access sign-up.",
    features: ["Glass design", "Feature bento", "How it works", "Early-access list"],
    requiredIntegrations: [],
    brief: "A mobile app launch page with features, how it works, FAQ and early access sign-up",
    defaultName: "Pocket",
  },
  {
    id: "dental",
    name: "Dental & medical clinic",
    category: "Health",
    description: "Calm, clinical design with services, first-visit steps and appointment requests.",
    features: ["Services", "First visit steps", "Appointment requests", "FAQ"],
    requiredIntegrations: [],
    brief: "A modern dental clinic with treatments, online appointment booking and FAQ",
    defaultName: "Bright Smile Dental",
  },
  {
    id: "law",
    name: "Law firm",
    category: "Professional services",
    description: "Practice areas, how you work with clients and confidential consultation requests.",
    features: ["Practice areas", "Process", "Consultation form", "FAQ"],
    requiredIntegrations: [],
    brief: "A law firm website with practice areas, our approach and consultation requests",
    defaultName: "Mehra & Associates",
  },
  {
    id: "accounting",
    name: "Accounting firm",
    category: "Professional services",
    description: "Services, fixed monthly plans and a free discovery call.",
    features: ["Services", "Monthly plans", "Key figures", "FAQ"],
    requiredIntegrations: [],
    brief: "An accounting and tax advisory firm with services, monthly pricing plans and FAQ",
    defaultName: "Ledgerline Accountants",
  },
  {
    id: "photography",
    name: "Photographer",
    category: "Creative",
    description: "Gallery-first design with packages, process and date enquiries.",
    features: ["Gallery", "Packages", "Process", "Enquiry form"],
    requiredIntegrations: [],
    brief: "A wedding and portrait photographer with a gallery, packages and enquiries",
    defaultName: "Aria Lens Studio",
  },
  {
    id: "wedding",
    name: "Wedding & event planner",
    category: "Events",
    description: "Romantic editorial style with services, planning steps and recent celebrations.",
    features: ["Services", "Planning steps", "Gallery", "Consultation form"],
    requiredIntegrations: [],
    brief: "A wedding and event planning company with services, gallery and consultations",
    defaultName: "Ever After Events",
  },
  {
    id: "hotel",
    name: "Boutique hotel",
    category: "Hospitality",
    description: "Luxurious full-bleed imagery, rooms and dining, and availability requests.",
    features: ["Rooms & spaces", "Dining & spa", "Availability requests", "FAQ"],
    requiredIntegrations: [],
    brief: "A luxury boutique hotel with rooms, dining, a spa and booking",
    defaultName: "Casa Alba",
  },
  {
    id: "travel",
    name: "Travel & tours",
    category: "Travel",
    description: "Inspiring destinations, how trips work and trip-planning enquiries.",
    features: ["Destinations gallery", "How it works", "Trip enquiries", "FAQ"],
    requiredIntegrations: [],
    brief: "A travel company offering small-group tours and tailor-made holidays with a destinations gallery",
    defaultName: "Wander Atlas",
  },
  {
    id: "jewellery",
    name: "Jewellery atelier",
    category: "Retail",
    description: "Dark, refined luxury with collections, bespoke work and private viewings.",
    features: ["Collection gallery", "Bespoke service", "Private viewings", "Newsletter"],
    requiredIntegrations: [],
    brief: "A fine jewellery atelier with collections, bespoke rings and private viewings",
    defaultName: "Aurum Atelier",
  },
  {
    id: "fashion",
    name: "Fashion label",
    category: "Retail",
    description: "Minimal, editorial lookbook with the new collection and a launch list.",
    features: ["Lookbook", "Brand story", "Newsletter"],
    requiredIntegrations: [],
    brief: "A minimal fashion label with the new collection, brand story and newsletter",
    defaultName: "Maison Nila",
  },
  {
    id: "architecture",
    name: "Architecture studio",
    category: "Creative",
    description: "Understated portfolio with services, process and project enquiries.",
    features: ["Selected projects", "Services", "Process", "Enquiry form"],
    requiredIntegrations: [],
    brief: "An architecture and interior design studio with selected projects and our process",
    defaultName: "Linea Studio",
  },
  {
    id: "music",
    name: "Musician & band",
    category: "Entertainment",
    description: "Dark, atmospheric design with new releases, live dates and a fan list.",
    features: ["Releases & dates", "Photo gallery", "Fan newsletter", "Booking enquiries"],
    requiredIntegrations: [],
    brief: "A band website with new music, live gigs, a photo gallery and a newsletter",
    defaultName: "The Night Owls",
  },
  {
    id: "automotive",
    name: "Auto garage & detailing",
    category: "Automotive",
    description: "Bold, high-contrast design with a service menu and online service booking.",
    features: ["Service menu", "Key figures", "Service booking", "FAQ"],
    requiredIntegrations: [],
    brief: "A car service garage and detailing studio with services, prices and online booking",
    defaultName: "Torque & Shine",
  },
  {
    id: "homeservices",
    name: "Home services",
    category: "Local services",
    description: "Trust-first design for trades with how it works and free quote requests.",
    features: ["Services", "How it works", "Quote requests", "FAQ"],
    requiredIntegrations: [],
    brief: "A plumbing and electrical home repair company with services, how it works and free quotes",
    defaultName: "FixRight Home Services",
  },
  {
    id: "petcare",
    name: "Pet grooming & daycare",
    category: "Pets",
    description: "Friendly, colourful design with services, happy regulars and visit booking.",
    features: ["Services", "Gallery", "Visit booking", "FAQ"],
    requiredIntegrations: [],
    brief: "A pet grooming and doggy daycare with services, a gallery and booking",
    defaultName: "Waggle & Co.",
  },
  {
    id: "nonprofit",
    name: "Nonprofit & charity",
    category: "Community",
    description: "Hopeful, transparent design with programmes, impact and ways to help.",
    features: ["Programmes", "Impact figures", "Ways to help", "Newsletter"],
    requiredIntegrations: [],
    brief: "A charity supporting children's education with our programmes, impact and volunteer sign-up",
    defaultName: "Bright Futures Foundation",
  },
  // ── Made for specific businesses ──
  {
    id: "patisserie",
    name: "Patisserie & cake studio",
    category: "Hospitality",
    description: "Editorial, airy design for signature cakes, the counter menu and custom orders.",
    features: ["Signature cakes", "Counter menu", "Custom order requests", "Gallery"],
    requiredIntegrations: [],
    brief: "A French patisserie and custom cake studio with signature cakes, a counter menu, custom order requests and a gallery",
    defaultName: "Maison Sucre",
    personality: "editorial",
    hero: { eyebrow: "Patisserie & cake studio", heading: "Butter, sugar and patience.", sub: "Viennoiserie every morning, signature cakes all day, and celebration cakes made to order." },
    photos: [["1486427944299-d1955d23e34d", "Frosted cupcakes in a row"], ["1586985289688-ca3cf47d3e6e", "A cake being iced"], ["1488477181946-6428a0291777", "Strawberry desserts in glasses"], ["1517433670267-08bbd4be890f", "A bakery counter full of pastries"]],
  },
  {
    id: "fine-dining",
    name: "Fine dining",
    category: "Hospitality",
    description: "Dark, refined design with a tasting menu, the chef's story and reservations.",
    features: ["Tasting menu", "Chef's story", "Private dining", "Reservations"],
    requiredIntegrations: [],
    brief: "A fine dining restaurant with a seasonal tasting menu, the chef's story, private dining and table reservations",
    defaultName: "Ember & Oak",
    personality: "luxury",
    hero: { eyebrow: "Seasonal tasting menu", heading: "Fire, season and time.", sub: "A tasting menu cooked over open flame, with wines chosen for every course." },
    photos: [["1414235077428-338989a2e8c0", "A plated dish at the pass"], ["1544025162-d76694265947", "Slow-cooked ribs with charred vegetables"], ["1559339352-11d035aa65de", "A terrace dining room by the water"], ["1517248135467-4c7edcad34c4", "The dining room at night"]],
  },
  {
    id: "bar-lounge",
    name: "Bar & lounge",
    category: "Hospitality",
    description: "Bold, after-dark design for signature cocktails, events and table bookings.",
    features: ["Cocktail menu", "Events", "Table reservations", "Gallery"],
    requiredIntegrations: [],
    brief: "A cocktail bar and lounge with signature cocktails, bar snacks, weekend events and table reservations",
    defaultName: "The Copper Still",
    personality: "bold",
    hero: { eyebrow: "Cocktails & late nights", heading: "Stirred, shaken, remembered.", sub: "Signature cocktails, small plates and weekend sets in a room made for long evenings." },
    photos: [["1572116469696-31de0f17cc34", "A glowing back bar lined with bottles"], ["1514362545857-3bc16c4c7d1b", "A signature cocktail on the bar"], ["1536935338788-846bb9981813", "A berry cocktail with citrus"], ["1470337458703-46ad1756a187", "Whisky poured over ice"]],
  },
  {
    id: "resort",
    name: "Resort & villas",
    category: "Hospitality",
    description: "Sun-washed luxury design with suites, dining, spa, experiences and booking.",
    features: ["Rooms & villas", "Dining & spa", "Experiences", "Booking requests"],
    requiredIntegrations: [],
    brief: "A beachside resort with rooms, suites and private villas, dining, a spa, experiences and booking",
    defaultName: "Azure Bay Resort",
    personality: "luxury",
    hero: { eyebrow: "Beachside resort & villas", heading: "Where the sea sets the pace.", sub: "Ocean-view suites, private pool villas, a spa and dining by the water." },
    photos: [["1540541338287-41700207dee6", "The resort pool above the ocean"], ["1571896349842-33c89424de2d", "An infinity pool at dusk"], ["1582719508461-905c673771fd", "A sun deck facing the sea"], ["1590490360182-c33d57733427", "A suite with a lounge"]],
  },
  {
    id: "hair-salon",
    name: "Hair & beauty salon",
    category: "Wellness",
    description: "Clean, modern design with a price list, stylists and online appointments.",
    features: ["Services & prices", "Our stylists", "Appointment booking", "Gallery"],
    requiredIntegrations: [],
    brief: "A unisex hair and beauty salon with services and prices, our stylists, a gallery and appointment booking",
    defaultName: "Studio Mane",
    personality: "modern",
    hero: { eyebrow: "Hair & beauty", heading: "Hair you'll want to show off.", sub: "Cuts, colour and care from stylists who listen \u2014 book your chair in seconds." },
    photos: [["1560066984-138dadb4c035", "A bright salon floor with styling chairs"], ["1562322140-8baeececf3df", "A stylist blow-drying a client's hair"], ["1522337360788-8b13dee7a37e", "Long, glossy hair"]],
  },
  {
    id: "makeup-studio",
    name: "Makeup & beauty studio",
    category: "Wellness",
    description: "Elegant design for makeup packages for brides and parties, a portfolio and bookings.",
    features: ["Packages", "Portfolio gallery", "Client reviews", "Booking requests"],
    requiredIntegrations: [],
    brief: "A makeup artist and beauty studio for brides and parties with packages, a portfolio gallery, client reviews and booking",
    defaultName: "Rouge Atelier",
    personality: "editorial",
    hero: { eyebrow: "Makeup for brides & parties", heading: "Your day, your face, flawless.", sub: "Makeup that lasts from the first photo to the last dance \u2014 for brides, guests and every celebration." },
    photos: [["1487412947147-5cebf100ffc2", "Makeup being applied with a brush"], ["1522337360788-8b13dee7a37e", "Styled hair"], ["1540555700478-4be289fbecef", "A calm studio corner with flowers"]],
  },
  {
    id: "multispecialty-clinic",
    name: "Multi-speciality clinic",
    category: "Health",
    description: "Trustworthy, structured design with departments, doctors, timings and appointments.",
    features: ["Departments", "Our doctors", "Timings", "Appointment booking"],
    requiredIntegrations: [],
    brief: "A multi-speciality medical clinic with departments, our doctors, clinic timings, health check-up packages and appointment booking",
    defaultName: "CarePoint Clinic",
    personality: "corporate",
    hero: { eyebrow: "Multi-speciality clinic", heading: "Every specialist, under one roof.", sub: "General medicine, paediatrics, women's health and more \u2014 with timings that suit you and online appointments." },
    photos: [["1631217868264-e5b90bb7e133", "A doctor talking with a patient"], ["1519494026892-80bbd2d6fd0d", "The clinic reception"], ["1584432810601-6c7f27d2362b", "A clinician in the consulting room"], ["1576091160550-2173dba999ef", "A stethoscope beside a laptop"]],
  },
  {
    id: "physio",
    name: "Physiotherapy & rehab",
    category: "Health",
    description: "Warm, encouraging design with treatments, how recovery works and booking.",
    features: ["Treatments", "How it works", "Therapists", "Appointment booking"],
    requiredIntegrations: [],
    brief: "A physiotherapy and sports rehab clinic with treatments, how recovery works, our therapists and appointment booking",
    defaultName: "Motion Physio",
    personality: "friendly",
    hero: { eyebrow: "Physiotherapy & sports rehab", heading: "Move better. Recover stronger.", sub: "Hands-on treatment and guided exercise plans to get you back to what you love." },
    photos: [["1519824145371-296894a0daa9", "Hands-on therapy on a shoulder"], ["1597452485669-2c7bb5fef90d", "Guided strength rehab in the gym"], ["1576091160399-112ba8d25d1d", "A clinician reviewing notes"]],
  },
  {
    id: "skin-clinic",
    name: "Skin & hair clinic",
    category: "Health",
    description: "Minimal, calm design for dermatology treatments, doctors and consultations.",
    features: ["Treatments", "Doctors", "FAQ", "Consultation booking"],
    requiredIntegrations: [],
    brief: "A dermatology skin and hair clinic with treatments, our doctors, FAQ and consultation booking",
    defaultName: "Derma Clear",
    personality: "minimal",
    hero: { eyebrow: "Dermatology & aesthetics", heading: "Healthy skin, expert care.", sub: "Treatment for acne, pigmentation, hair loss and everyday skin health \u2014 with a plan made for you." },
    photos: [["1570172619644-dfd03ed5d881", "A facial treatment in progress"], ["1616394584738-fc6e612e71b9", "A soothing mask being applied"], ["1584432810601-6c7f27d2362b", "A clinician in the consulting room"]],
  },
  {
    id: "eye-clinic",
    name: "Eye care & opticians",
    category: "Health",
    description: "Bright, modern design for eye tests, treatments, frames and appointments.",
    features: ["Eye tests", "Treatments", "Frames", "Appointment booking"],
    requiredIntegrations: [],
    brief: "An eye care clinic and opticians with eye tests, treatments, frames and lenses, our doctors and appointment booking",
    defaultName: "ClearView Eye Care",
    personality: "modern",
    hero: { eyebrow: "Eye care & opticians", heading: "See every detail clearly.", sub: "Comprehensive eye tests, treatment and frames \u2014 all in one visit." },
    photos: [["1574258495973-f010dfbb5371", "Glasses on a clean desk"], ["1511499767150-a48a237f0083", "Round sunglasses"], ["1584432810601-6c7f27d2362b", "An optometrist ready to help"]],
  },
  {
    id: "yoga-studio",
    name: "Yoga & meditation studio",
    category: "Fitness",
    description: "Natural, calm design with a class timetable, teachers and trial bookings.",
    features: ["Class timetable", "Teachers", "Memberships", "Trial class booking"],
    requiredIntegrations: [],
    brief: "A yoga and meditation studio with a class timetable, our teachers, memberships and trial class booking",
    defaultName: "Sattva Yoga",
    personality: "organic",
    hero: { eyebrow: "Yoga & meditation", heading: "Breathe in. Slow down.", sub: "Daily classes for every level, in a calm studio with teachers who know your name." },
    photos: [["1544367567-0f2fcb009e0b", "A yoga pose at sunset"], ["1506126613408-eca07ce68773", "Meditation in warm evening light"], ["1599901860904-17e6ed7083a0", "A downward dog in the studio"]],
  },
  {
    id: "boxing-gym",
    name: "Boxing & strength gym",
    category: "Fitness",
    description: "High-energy, bold design with programmes, coaches and free trials.",
    features: ["Programmes", "Coaches", "Membership plans", "Free trial"],
    requiredIntegrations: [],
    brief: "A boxing and strength training gym with programmes, coaches, membership plans and a free trial",
    defaultName: "Iron Ring",
    personality: "bold",
    hero: { eyebrow: "Boxing & strength", heading: "Train like a fighter.", sub: "Boxing, strength and conditioning with coaches in your corner \u2014 your first session is free." },
    photos: [["1517438322307-e67111335449", "Pad work with a coach"], ["1549719386-74dfcbf7dbed", "Boxing gloves on the mat"], ["1583473848882-f9a5bc7fd2ee", "Gloves resting in the gym"]],
  },
  {
    id: "blank",
    name: "Blank site",
    category: "Start from scratch",
    description: "A home page with navigation, a hero and a footer.",
    features: ["Home page"],
    requiredIntegrations: [],
    brief: "",
    defaultName: "Untitled site",
  },
];

export function templateSpec(t: Template, name?: string, personality?: string): ProjectSpec {
  const spec = planFromBrief(t.brief || "A simple website", { name: name || t.defaultName });
  // The planner picks a direction from the brief; the person may choose another look.
  const look = personality ?? t.personality;
  if (look && PERSONALITIES.some((p) => p.id === look)) spec.personality = look;
  if (t.id === "blank") {
    spec.pages = [{ path: "/", title: spec.name, purpose: "Home page", sections: ["navbar", "hero", "footer"] }];
    spec.questions = [];
    spec.dataModels = [];
  }
  spec.questions = spec.questions.filter((q) => q.id !== "name");
  return spec;
}

/**
 * The site a template starts as: a crafted site, or one composed from its brief
 * — with the template's own hero words and photos where it has them.
 */
export function templateDoc(t: Template, name?: string, personality?: string): SiteDoc {
  const crafted = craftedDoc(t, name);
  if (crafted) return crafted;
  const doc = composeSite(templateSpec(t, name, personality));
  if (!t.hero && !t.photos?.length) return doc;
  let n = 0;
  const next = () => {
    const p = t.photos![n++ % t.photos!.length];
    return { src: photoUrl(p[0], 1800), alt: p[1] };
  };
  for (const page of doc.pages)
    for (const s of page.sections) {
      if (s.type === "hero" && page.path === "/" && t.hero) Object.assign(s.props, { eyebrow: t.hero.eyebrow, heading: t.hero.heading, subheading: t.hero.sub });
      if (!t.photos?.length) continue;
      if (typeof s.props.image === "string" && s.props.image) {
        const p = next();
        s.props.image = p.src;
        if ("imageAlt" in s.props) s.props.imageAlt = p.alt;
      }
      if (Array.isArray(s.props.images))
        s.props.images = (s.props.images as { src?: string; alt?: string }[]).map((im) => (im && typeof im.src === "string" ? { ...im, ...next() } : im));
    }
  return doc;
}

/** The finished site for a crafted template, or null for brief-based ones. */
export function craftedDoc(t: Template, name?: string): SiteDoc | null {
  const c = t.crafted ? CRAFTED[t.crafted] : undefined;
  return c ? craftedSiteDoc(c, name || t.defaultName) : null;
}
