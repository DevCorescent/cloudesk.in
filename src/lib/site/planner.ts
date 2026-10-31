// Rule-based planner and composer. These run without any AI provider and are
// labelled as such in the UI. They produce the same structures an LLM planner
// must produce, so the rest of the pipeline does not care which one ran.
//
// The composer works like an art director: it picks a design direction,
// orders sections for the industry's conversion goal, writes specific copy,
// and places photography where it carries the story. Anything that would be
// misleading if published unchanged (figures, team names, client logos,
// reviews) is marked as example content and blocks production deploys until
// edited.
import { applyPersonality, directionChoices, suggestPersonality } from "./design";
import { photoUrl, pickPhotos } from "./media";
import { createSection, newId, serializeSiteDoc, siteDocSchema, type Page, type Section, type SiteDoc } from "./model";
import type { ProjectSpec } from "./spec";

type Feature = { icon: string; title: string; body: string };

type Industry = {
  key: string;
  match: RegExp;
  label: string;
  theme: string;
  audience: string;
  tone: string;
  goals: string[];
  photoTags: string[];
  eyebrow: string;
  heroHeading: (name: string) => string;
  heroSub: string;
  primary: { label: string; target: "booking" | "contact" | "pricing" | "menu" | "gallery" };
  features: { heading: string; sub: string; items: Feature[] };
  story: { eyebrow: string; heading: string; body: string; bullets: string[] };
  steps?: { heading: string; items: { title: string; body: string }[] };
  stats?: { value: string; label: string }[];
  /** Sections this industry adds to the home page beyond the brief's requests. */
  extras: Section["type"][];
  cta: string;
};

const INDUSTRIES: Industry[] = [
  // ── Specific industries first: their patterns are narrower than the general ones below.
  {
    key: "hotel",
    match: /hotel|resort|homestay|guest ?house|bed and breakfast|\bb&b\b|\binn\b|\blodge\b/i,
    label: "Hotel",
    theme: "warm",
    audience: "Travellers looking for a memorable, comfortable stay",
    tone: "Gracious, unhurried, assured",
    goals: ["Win direct bookings", "Show rooms and experiences", "Answer practical questions before guests ask"],
    photoTags: ["hotel"],
    eyebrow: "Hotel & suites",
    heroHeading: (n) => `${n}. Stay a little longer.`,
    heroSub: "Considered rooms, a quiet pool and a team that remembers how you take your coffee.",
    primary: { label: "Check availability", target: "booking" },
    features: {
      heading: "Everything, taken care of",
      sub: "",
      items: [
        { icon: "house", title: "Rooms & suites", body: "Calm, light-filled rooms with the bed you'll want to take home." },
        { icon: "utensils", title: "Dining", body: "Breakfast until late, and a kitchen that cooks from the region." },
        { icon: "sun", title: "Pool & spa", body: "Somewhere to do nothing at all, beautifully." },
      ],
    },
    story: { eyebrow: "The house", heading: "A place with a point of view", body: "[Replace with your story] Tell guests about the building, the setting and what makes a stay here different.", bullets: ["Airport transfers on request", "Late check-out when available", "Free wifi throughout"] },
    extras: ["split", "gallery", "faq"],
    cta: "Your room is ready",
  },
  {
    key: "jewellery",
    match: /jewel|diamond|goldsmith|silversmith/i,
    label: "Jewellery",
    theme: "warm",
    audience: "People choosing a piece to mark a moment or to wear every day",
    tone: "Refined, intimate, precise",
    goals: ["Showcase collections", "Bring in appointment and custom-order enquiries", "Build trust in materials and craft"],
    photoTags: ["jewellery"],
    eyebrow: "Fine jewellery",
    heroHeading: (n) => `${n}. Made to be kept.`,
    heroSub: "Pieces made by hand in small numbers, from responsibly sourced metals and stones.",
    primary: { label: "Book a private viewing", target: "booking" },
    features: {
      heading: "Crafted, not manufactured",
      sub: "",
      items: [
        { icon: "gem", title: "Certified stones", body: "Every stone comes with its paperwork. Ask to see it." },
        { icon: "magic", title: "Bespoke pieces", body: "Sketch, wax, cast, set: we design it with you." },
        { icon: "shield", title: "Lifetime care", body: "Cleaning, resizing and repairs for as long as you wear it." },
      ],
    },
    story: { eyebrow: "The atelier", heading: "Small studio, slow work", body: "[Replace with your story] Who makes the pieces, where, and what you will never compromise on.", bullets: ["Hallmarked metals", "Gift wrapping included", "Engraving available"] },
    extras: ["split", "gallery", "newsletter"],
    cta: "Find the one",
  },
  {
    key: "photography",
    match: /photograph|videograph|filmmak|photo studio|cinematograph/i,
    label: "Photography",
    theme: "minimal",
    audience: "Couples, families and brands who want images that feel like them",
    tone: "Observant, warm, unpretentious",
    goals: ["Show the best work quickly", "Explain packages", "Turn interest into enquiries with dates"],
    photoTags: ["photography", "creative"],
    eyebrow: "Photography",
    heroHeading: (n) => `${n}. Pictures that feel like the day felt.`,
    heroSub: "Natural, honest photography for weddings, portraits and brands.",
    primary: { label: "Check my date", target: "contact" },
    features: {
      heading: "How I work",
      sub: "",
      items: [
        { icon: "camera", title: "Documentary first", body: "Real moments as they happen, with gentle direction when it helps." },
        { icon: "palette", title: "Timeless edit", body: "Colour that still looks right in twenty years." },
        { icon: "clock", title: "Galleries in weeks", body: "A private online gallery to download and share." },
      ],
    },
    story: { eyebrow: "About me", heading: "Behind the camera", body: "[Replace with your story] Who you are, how you got here and what you love to photograph.", bullets: ["Travel worldwide", "Second shooter available", "Prints and albums"] },
    steps: { heading: "From enquiry to gallery", items: [{ title: "Tell me about it", body: "Your date, place and what matters most." }, { title: "Plan together", body: "A call to shape the timeline and shot list." }, { title: "Relax on the day", body: "I'll be there early and stay out of the way." }] },
    extras: ["gallery", "split", "steps", "pricing"],
    cta: "Let's make something lasting",
  },
  {
    key: "wedding",
    match: /wedding|bridal|event plann|event management|party plann/i,
    label: "Weddings & events",
    theme: "warm",
    audience: "Couples and hosts planning a celebration that runs without a hitch",
    tone: "Joyful, calm, detail-minded",
    goals: ["Turn browsers into consultation calls", "Show real celebrations", "Explain what is included"],
    photoTags: ["wedding", "events"],
    eyebrow: "Weddings & celebrations",
    heroHeading: (n) => `${n}. Celebrations, beautifully handled.`,
    heroSub: "From the first idea to the last dance, we plan every detail so you can be a guest at your own party.",
    primary: { label: "Plan a consultation", target: "contact" },
    features: {
      heading: "What we take off your plate",
      sub: "",
      items: [
        { icon: "calendar", title: "Full planning", body: "Budget, venues, suppliers and a timeline everyone can follow." },
        { icon: "palette", title: "Design & styling", body: "Flowers, tables and light that feel entirely yours." },
        { icon: "users", title: "On-the-day team", body: "We run the day so nobody has to ask you anything." },
      ],
    },
    story: { eyebrow: "Our story", heading: "We love a good plan — and a great party", body: "[Replace with your story] Tell couples who you are and the kind of celebrations you love making.", bullets: ["Destination weddings", "Trusted supplier list", "Clear, fixed fees"] },
    steps: { heading: "How planning works", items: [{ title: "Consultation", body: "We listen first: guests, budget, style." }, { title: "Design", body: "A plan and moodboard you can react to." }, { title: "Delivery", body: "We coordinate everyone, right up to the send-off." }] },
    extras: ["split", "steps", "gallery", "faq"],
    cta: "Tell us about your day",
  },
  {
    key: "app",
    match: /mobile app|ios app|android app|iphone app|app store|play store|app launch/i,
    label: "Mobile app",
    theme: "minimal",
    audience: "People who will download, try and keep using the app",
    tone: "Clear, confident, delightful",
    goals: ["Drive downloads", "Explain the app in seconds", "Collect early-access sign-ups"],
    photoTags: ["app"],
    eyebrow: "Now on iPhone and Android",
    heroHeading: (n) => `${n}. Everything you need, right in your pocket.`,
    heroSub: "A fast, beautifully simple app that does one job brilliantly — and never gets in your way.",
    primary: { label: "Get early access", target: "contact" },
    features: {
      heading: "Designed to feel effortless",
      sub: "",
      items: [
        { icon: "zap", title: "Fast by default", body: "Opens instantly and works offline when the signal drops." },
        { icon: "lock", title: "Private by design", body: "Your data stays on your device unless you choose to sync." },
        { icon: "sparkles", title: "Thoughtful details", body: "Widgets, dark mode and gestures that feel natural." },
      ],
    },
    story: { eyebrow: "Why we built it", heading: "Made by people who needed it", body: "[Replace with your story] What problem the app solves and who it is for.", bullets: ["No ads", "Sync across devices", "Accessible from day one"] },
    steps: { heading: "Up and running in a minute", items: [{ title: "Download", body: "From the App Store or Google Play." }, { title: "Set it up", body: "A few taps, no long forms." }, { title: "Make it yours", body: "Choose what you see first." }] },
    extras: ["steps", "split", "faq", "newsletter"],
    cta: "Be first to try it",
  },
  {
    key: "clinic",
    match: /dentist|dental|clinic|doctor|physician|physiotherap|medical|hospital|orthodont|dermatolog|paediatric|pediatric|diagnostic|optometr|eye care/i,
    label: "Medical clinic",
    theme: "fresh",
    audience: "Patients and families looking for trustworthy, accessible care",
    tone: "Reassuring, clear, professional",
    goals: ["Fill appointment slots", "Explain services and what to expect", "Make the clinic easy to reach"],
    photoTags: ["clinic", "medical", "dental"],
    eyebrow: "Clinic & care",
    heroHeading: (n) => `Care you can trust at ${n}.`,
    heroSub: "Experienced clinicians, modern equipment and appointments that run on time.",
    primary: { label: "Book an appointment", target: "booking" },
    features: {
      heading: "Care built around you",
      sub: "",
      items: [
        { icon: "heart", title: "Patient-first", body: "Time to listen, explain and agree a plan together." },
        { icon: "shield", title: "Safe & certified", body: "Rigorous hygiene and qualified, registered clinicians." },
        { icon: "clock", title: "Easy to see us", body: "Early, late and weekend appointments." },
      ],
    },
    story: { eyebrow: "About the clinic", heading: "Modern care, personal attention", body: "[Replace with your story] Introduce the clinic, its specialities and its clinicians' qualifications.", bullets: ["Insurance accepted [check and edit]", "Wheelchair accessible", "Reminders by SMS"] },
    steps: { heading: "Your first appointment", items: [{ title: "Book online", body: "Choose a time that suits you." }, { title: "Consultation", body: "We assess, explain and answer your questions." }, { title: "Your plan", body: "Clear next steps and costs before any treatment." }] },
    extras: ["split", "steps", "faq"],
    cta: "Book a visit this week",
  },
  {
    key: "law",
    match: /law firm|lawyer|attorney|advocate|legal|solicitor|barrister|litigation/i,
    label: "Law firm",
    theme: "minimal",
    audience: "Individuals and businesses who need sound legal advice",
    tone: "Authoritative, plain-spoken, discreet",
    goals: ["Generate qualified consultations", "Explain practice areas", "Build credibility"],
    photoTags: ["law"],
    eyebrow: "Advocates & legal advisers",
    heroHeading: (n) => `${n}. Clear advice when it matters most.`,
    heroSub: "Practical legal counsel for individuals and businesses, explained in plain language.",
    primary: { label: "Request a consultation", target: "contact" },
    features: {
      heading: "Practice areas",
      sub: "",
      items: [
        { icon: "briefcase", title: "Corporate & commercial", body: "Contracts, disputes and company matters." },
        { icon: "house", title: "Property & real estate", body: "Due diligence, transactions and title." },
        { icon: "users", title: "Family & personal", body: "Sensitive matters handled with care and discretion." },
      ],
    },
    story: { eyebrow: "The firm", heading: "Experience you can rely on", body: "[Replace with your story] Describe the firm, its partners and its approach. Avoid promising outcomes.", bullets: ["Confidential first call", "Transparent fee estimates", "English and regional languages"] },
    extras: ["split", "steps", "faq"],
    steps: { heading: "How we work with you", items: [{ title: "Initial consultation", body: "We understand the facts and your goals." }, { title: "Clear options", body: "Advice on routes, risks and likely costs." }, { title: "Representation", body: "We act for you and keep you informed." }] },
    cta: "Talk to a lawyer",
  },
  {
    key: "finance",
    match: /accountant|accounting|bookkeep|chartered accountant|\bca firm|tax (?:filing|return|consult|advis)|auditor|financial (?:advis|planning|planner)|wealth manag/i,
    label: "Accounting & finance",
    theme: "minimal",
    audience: "Business owners and individuals who want their numbers handled properly",
    tone: "Precise, calm, trustworthy",
    goals: ["Win new clients", "Explain services and fees", "Show credentials"],
    photoTags: ["finance", "accounting"],
    eyebrow: "Accounting & advisory",
    heroHeading: (n) => `${n}. Numbers handled, decisions made easier.`,
    heroSub: "Accounting, tax and advisory for growing businesses and busy people.",
    primary: { label: "Book a free call", target: "contact" },
    features: {
      heading: "What we do",
      sub: "",
      items: [
        { icon: "chart", title: "Accounts & bookkeeping", body: "Monthly books, payroll and reports you can understand." },
        { icon: "check", title: "Tax & compliance", body: "Filings on time, every time, with no surprises." },
        { icon: "lightbulb", title: "Advisory", body: "Cash-flow planning and honest advice on what's next." },
      ],
    },
    story: { eyebrow: "About us", heading: "Your finance team, without the overhead", body: "[Replace with your story] Who the partners are, credentials and the clients you serve best.", bullets: ["Fixed monthly fees", "Cloud accounting", "Named point of contact"] },
    stats: [{ value: "15+", label: "Years in practice" }, { value: "200", label: "Clients" }, { value: "48h", label: "Response time" }],
    extras: ["stats", "split", "pricing", "faq"],
    cta: "Get your evenings back",
  },
  {
    key: "architecture",
    match: /architect|interior design|interior studio|interiors studio/i,
    label: "Architecture & interiors",
    theme: "minimal",
    audience: "Homeowners and developers planning a considered build or renovation",
    tone: "Thoughtful, precise, understated",
    goals: ["Show a strong portfolio", "Explain the design process", "Attract the right projects"],
    photoTags: ["architecture", "interior", "home"],
    eyebrow: "Architecture & interiors",
    heroHeading: (n) => `${n}. Spaces that shape how you live.`,
    heroSub: "Residential and commercial architecture and interiors, from first sketch to final fit-out.",
    primary: { label: "Start a project", target: "contact" },
    features: {
      heading: "Services",
      sub: "",
      items: [
        { icon: "layers", title: "Architecture", body: "New builds, extensions and adaptive reuse." },
        { icon: "palette", title: "Interiors", body: "Materials, joinery, lighting and furniture." },
        { icon: "check", title: "Project delivery", body: "Approvals, tender and site supervision." },
      ],
    },
    story: { eyebrow: "Studio", heading: "Design with restraint", body: "[Replace with your story] Your studio's philosophy, team and the projects you are proudest of.", bullets: ["Sustainable materials", "3D walkthroughs", "Fixed design fees"] },
    steps: { heading: "Our process", items: [{ title: "Brief", body: "How you live and what you need." }, { title: "Concept", body: "Options, sketches and a budget check." }, { title: "Detail & build", body: "Drawings, approvals and site visits." }] },
    extras: ["gallery", "split", "steps"],
    cta: "Let's talk about your space",
  },
  {
    key: "fashion",
    match: /fashion|clothing|apparel|couture|streetwear|ethnic wear|saree|menswear|womenswear/i,
    label: "Fashion",
    theme: "minimal",
    audience: "Style-conscious shoppers who care how things are made",
    tone: "Confident, editorial, effortless",
    goals: ["Launch collections", "Grow the mailing list", "Drive store visits and online orders"],
    photoTags: ["fashion"],
    eyebrow: "New season",
    heroHeading: (n) => `${n}. Wear it your way.`,
    heroSub: "Small-batch pieces in natural fabrics, designed to last longer than a season.",
    primary: { label: "Shop the collection", target: "gallery" },
    features: {
      heading: "Made with intention",
      sub: "",
      items: [
        { icon: "leaf", title: "Natural fabrics", body: "Cotton, linen and wool that feel better with every wash." },
        { icon: "scissors", title: "Small batches", body: "Made in limited runs, so nothing goes to waste." },
        { icon: "truck", title: "Easy returns", body: "Free exchanges within 30 days [edit to match your policy]." },
      ],
    },
    story: { eyebrow: "The label", heading: "Clothes for real life", body: "[Replace with your story] Who designs the collection, where it's made and why.", bullets: ["Ethically produced", "Sizes XS–XXL", "Gift cards"] },
    extras: ["gallery", "split", "newsletter"],
    cta: "Find your new favourite",
  },
  {
    key: "music",
    match: /musician|\bband\b|singer|\bdj\b|music|concert|recording artist|record label|orchestra|choir|live gigs?/i,
    label: "Music & entertainment",
    theme: "minimal",
    audience: "Fans, promoters and event bookers",
    tone: "Bold, atmospheric, personal",
    goals: ["Sell shows and grow the audience", "Share new releases", "Get booked"],
    photoTags: ["music"],
    eyebrow: "New music out now",
    heroHeading: (n) => `${n}. Turn it up.`,
    heroSub: "New songs, live dates and the stories behind them.",
    primary: { label: "Book a show", target: "contact" },
    features: {
      heading: "Listen, watch, come along",
      sub: "",
      items: [
        { icon: "sparkles", title: "Latest release", body: "[Add your newest single or album and where to stream it]" },
        { icon: "calendar", title: "Live dates", body: "[Add upcoming shows with venues and ticket links]" },
        { icon: "chat", title: "Bookings & press", body: "Weddings, festivals and private events — get in touch." },
      ],
    },
    story: { eyebrow: "Bio", heading: "The story so far", body: "[Replace with your story] Where you're from, who you play with and what your music sounds like.", bullets: [] },
    extras: ["gallery", "split", "newsletter"],
    cta: "See you at the front",
  },
  {
    key: "automotive",
    match: /\bcars?\b|automotive|auto repair|garage|mechanic|car wash|detailing|motorbike|motorcycle|\btyres?\b|\btires?\b|dealership/i,
    label: "Automotive",
    theme: "minimal",
    audience: "Drivers who want their vehicle looked after properly",
    tone: "Direct, competent, no-nonsense",
    goals: ["Fill the workshop diary", "Explain services and prices", "Build trust with honest communication"],
    photoTags: ["automotive"],
    eyebrow: "Service & repair",
    heroHeading: (n) => `${n}. Your car, in expert hands.`,
    heroSub: "Servicing, repairs and detailing with clear quotes and no surprises.",
    primary: { label: "Book a service", target: "booking" },
    features: {
      heading: "What we do",
      sub: "",
      items: [
        { icon: "check", title: "Servicing", body: "Manufacturer-schedule servicing that protects your warranty." },
        { icon: "zap", title: "Diagnostics & repair", body: "We find the fault, quote first and fix it right." },
        { icon: "sparkles", title: "Detailing", body: "Inside and out, showroom-ready again." },
      ],
    },
    story: { eyebrow: "The workshop", heading: "Mechanics who explain things", body: "[Replace with your story] Who runs the workshop, experience and the makes you specialise in.", bullets: ["Pick-up and drop-off", "Genuine parts", "Photos of the work done"] },
    stats: [{ value: "20+", label: "Years in the trade" }, { value: "6", label: "Service bays" }, { value: "1 day", label: "Typical turnaround" }],
    extras: ["stats", "split", "pricing", "faq"],
    cta: "Get back on the road",
  },
  {
    key: "homeservices",
    match: /plumb|electrician|cleaning service|house cleaning|cleaners|renovat|contractor|handyman|roofing|carpent|pest control|painting service|painters|\bhvac\b|landscap|home repair|appliance repair/i,
    label: "Home services",
    theme: "minimal",
    audience: "Homeowners and tenants who need reliable help, fast",
    tone: "Dependable, friendly, straightforward",
    goals: ["Generate quote requests", "Show service areas and reliability", "Make calling and messaging effortless"],
    photoTags: ["homeservices"],
    eyebrow: "Local & insured",
    heroHeading: (n) => `${n}. Done right, the first time.`,
    heroSub: "Reliable, tidy professionals for repairs, installations and maintenance near you.",
    primary: { label: "Get a free quote", target: "contact" },
    features: {
      heading: "Why neighbours call us",
      sub: "",
      items: [
        { icon: "clock", title: "On time", body: "We give you a time window and we keep it." },
        { icon: "shield", title: "Insured & guaranteed", body: "Fully insured work with a workmanship guarantee [edit to match]." },
        { icon: "check", title: "Upfront pricing", body: "A fixed quote before we start. No surprises." },
      ],
    },
    story: { eyebrow: "About us", heading: "Local, family-run, here to help", body: "[Replace with your story] Who you are, the areas you cover and how long you've been doing it.", bullets: ["Emergency call-outs", "Tidy, respectful team", "Card and UPI payments"] },
    steps: { heading: "How it works", items: [{ title: "Tell us the job", body: "A few details and photos if you have them." }, { title: "Get a fixed quote", body: "Clear price and a time that suits you." }, { title: "Job done", body: "We tidy up and you pay when you're happy." }] },
    extras: ["steps", "split", "faq"],
    cta: "Get your quote today",
  },
  {
    key: "petcare",
    match: /\bpets?\b|\bdogs?\b|\bcats?\b|pet grooming|dog grooming|\bvet\b|veterinar|kennel|puppy|doggy daycare|pet boarding/i,
    label: "Pet care",
    theme: "warm",
    audience: "Pet parents who want the best for their animals",
    tone: "Warm, playful, caring",
    goals: ["Fill grooming and daycare slots", "Build trust with new pet parents", "Keep regulars coming back"],
    photoTags: ["pets"],
    eyebrow: "Grooming, daycare & care",
    heroHeading: (n) => `${n}. Happy pets, happier humans.`,
    heroSub: "Gentle grooming, playful daycare and caring hands — your pet's favourite place to be.",
    primary: { label: "Book a visit", target: "booking" },
    features: {
      heading: "All the good stuff",
      sub: "",
      items: [
        { icon: "scissors", title: "Grooming", body: "Baths, trims and nail care with calm, patient handling." },
        { icon: "sun", title: "Daycare", body: "Supervised play, rest time and lots of fuss." },
        { icon: "heart", title: "Health first", body: "Trained staff and gentle, pet-safe products." },
      ],
    },
    story: { eyebrow: "Our pack", heading: "Run by animal lovers", body: "[Replace with your story] Who looks after the pets and how you keep them safe and happy.", bullets: ["Pick-up service", "Photo updates", "Vaccination records checked"] },
    extras: ["split", "gallery", "faq"],
    cta: "Your pet's next favourite day",
  },
  {
    key: "nonprofit",
    match: /non-?profit|charity|\bngo\b|foundation|donation|donate|volunteer/i,
    label: "Nonprofit",
    theme: "fresh",
    audience: "Supporters, volunteers and partners who want to make a difference",
    tone: "Hopeful, transparent, human",
    goals: ["Raise donations", "Recruit volunteers", "Show impact transparently"],
    photoTags: ["nonprofit"],
    eyebrow: "Together we can",
    heroHeading: (n) => `${n}. Small acts, lasting change.`,
    heroSub: "We work alongside communities so every child, family and neighbour has a fair chance.",
    primary: { label: "Get involved", target: "contact" },
    features: {
      heading: "What we do",
      sub: "",
      items: [
        { icon: "education", title: "Education", body: "[Describe your programme] Learning support where it's needed most." },
        { icon: "heart", title: "Health & wellbeing", body: "[Describe your programme] Access to basic care and nutrition." },
        { icon: "handshake", title: "Community", body: "[Describe your programme] Local leaders, local solutions." },
      ],
    },
    story: { eyebrow: "Our mission", heading: "Why we exist", body: "[Replace with your story] The need you saw, how you started and how donations are used. Publish real figures only.", bullets: ["Registered charity [add number]", "Annual report published", "Tax-deductible donations [check eligibility]"] },
    stats: [{ value: "12", label: "Communities supported" }, { value: "3,000", label: "People reached" }, { value: "85%", label: "Of funds to programmes" }],
    extras: ["stats", "split", "steps", "newsletter"],
    steps: { heading: "Ways to help", items: [{ title: "Donate", body: "One-off or monthly — every amount counts." }, { title: "Volunteer", body: "Give your time and skills." }, { title: "Partner", body: "Companies and schools working with us." }] },
    cta: "Join us",
  },
  {
    key: "travel",
    match: /travel|tour operator|tour company|tour package|guided tours?|\btrek|holiday|safari|itinerar|expedition|tourism/i,
    label: "Travel",
    theme: "fresh",
    audience: "Travellers looking for well-planned trips and real experiences",
    tone: "Inspiring, knowledgeable, trustworthy",
    goals: ["Turn inspiration into enquiries", "Showcase trips", "Make planning feel easy"],
    photoTags: ["travel", "nature", "adventure"],
    eyebrow: "Journeys & tours",
    heroHeading: (n) => `${n}. Go further, travel better.`,
    heroSub: "Small-group tours and tailor-made trips, planned by people who've been there.",
    primary: { label: "Plan my trip", target: "contact" },
    features: {
      heading: "Travel, thoughtfully",
      sub: "",
      items: [
        { icon: "globe", title: "Hand-picked trips", body: "Routes we've walked ourselves, with time to breathe." },
        { icon: "users", title: "Small groups", body: "Fewer people, better access, real connection." },
        { icon: "shield", title: "Looked after", body: "Local guides and support before, during and after." },
      ],
    },
    story: { eyebrow: "Who we are", heading: "Travellers first", body: "[Replace with your story] Who you are, where you specialise and how you support local communities.", bullets: ["Flexible dates", "Carbon-conscious options", "24/7 support on the road"] },
    steps: { heading: "How it works", items: [{ title: "Tell us your idea", body: "Where, when and what you love." }, { title: "Get your itinerary", body: "A day-by-day plan with clear pricing." }, { title: "Go", body: "We handle the details while you travel." }] },
    extras: ["gallery", "steps", "split", "faq"],
    cta: "Where to next?",
  },
  {
    key: "restaurant",
    match: /restaurant|bistro|\bbar\b|diner|eatery|kitchen|dining|pizzeria|trattoria|brasserie/i,
    label: "Restaurant",
    theme: "warm",
    audience: "Local diners and visitors looking for a memorable meal",
    tone: "Warm, inviting, confident",
    goals: ["Fill tables through reservations", "Show the menu clearly", "Make the venue easy to find and contact"],
    photoTags: ["restaurant", "food", "fine-dining"],
    eyebrow: "Restaurant & bar",
    heroHeading: (n) => `${n}. Seasonal food, served with care.`,
    heroSub: "An intimate dining room, a kitchen led by the seasons and a table waiting for you tonight.",
    primary: { label: "Book a table", target: "booking" },
    features: {
      heading: "An evening worth remembering",
      sub: "",
      items: [
        { icon: "utensils", title: "Seasonal menu", body: "Dishes built around what is fresh this week, cooked over open flame." },
        { icon: "wine", title: "Thoughtful pairings", body: "A short, considered list of wines and cocktails to match every course." },
        { icon: "users", title: "Private dining", body: "A room for celebrations, team dinners and long tables of friends." },
      ],
    },
    story: { eyebrow: "Our story", heading: "Cooking the way we like to eat", body: "[Replace with your story] Share how the restaurant began, who is in the kitchen and what makes a meal here different.", bullets: ["Locally sourced produce", "Everything made in-house", "Open late on weekends"] },
    extras: ["split", "gallery"],
    cta: "Your table is waiting",
  },
  {
    key: "cafe",
    match: /cafe|café|coffee|bakery|patisserie|tea house|roaster/i,
    label: "Café",
    theme: "warm",
    audience: "Neighbours, remote workers and weekend visitors",
    tone: "Friendly, cosy, crafted",
    goals: ["Bring people through the door", "Show the menu and opening hours", "Build a loyal local following"],
    photoTags: ["cafe", "coffee", "food"],
    eyebrow: "Coffee & kitchen",
    heroHeading: (n) => `${n} — good coffee, slow mornings.`,
    heroSub: "Specialty coffee, fresh bakes every morning and a corner table with your name on it.",
    primary: { label: "See the menu", target: "menu" },
    features: {
      heading: "Small things, done properly",
      sub: "",
      items: [
        { icon: "coffee", title: "Roasted with care", body: "Single-origin beans, dialled in every morning." },
        { icon: "flame", title: "Baked daily", body: "Pastries and bread out of the oven before we open." },
        { icon: "wifi", title: "Stay a while", body: "Fast wifi, plenty of sockets and no rush." },
      ],
    },
    story: { eyebrow: "About us", heading: "A neighbourhood living room", body: "[Replace with your story] Tell people who you are and why you opened.", bullets: ["Oat and almond milk at no extra cost", "Dog friendly", "Takeaway cups that compost"] },
    extras: ["split", "gallery", "newsletter"],
    cta: "Come say hello",
  },
  {
    key: "wellness",
    match: /spa|salon|beauty|massage|wellness|yoga|pilates|meditation|skin|nail|barber/i,
    label: "Wellness & beauty",
    theme: "fresh",
    audience: "People looking to relax, recharge and look after themselves",
    tone: "Calm, reassuring, premium",
    goals: ["Fill appointment slots", "Explain treatments and prices", "Build trust with first-time visitors"],
    photoTags: ["spa", "wellness", "salon", "beauty"],
    eyebrow: "Wellness studio",
    heroHeading: (n) => `Slow down. ${n} takes care of the rest.`,
    heroSub: "Treatments designed around you, in a calm space where time slows down.",
    primary: { label: "Book an appointment", target: "booking" },
    features: {
      heading: "Care that goes deeper",
      sub: "",
      items: [
        { icon: "leaf", title: "Natural products", body: "Gentle, plant-based products chosen for sensitive skin." },
        { icon: "heart", title: "Experienced therapists", body: "Every treatment starts with a conversation about what you need." },
        { icon: "sun", title: "A space to breathe", body: "Quiet rooms, soft light and nothing to rush you." },
      ],
    },
    story: { eyebrow: "Our approach", heading: "Rituals, not routines", body: "[Replace with your story] Explain your philosophy and what a first visit feels like.", bullets: ["Consultation included", "Gift cards available", "Late appointments on Thursdays"] },
    steps: { heading: "Your first visit", items: [{ title: "Choose a treatment", body: "Pick from the menu or ask us to recommend one." }, { title: "Arrive and unwind", body: "Tea, a short consultation and time to settle in." }, { title: "Leave renewed", body: "Aftercare advice to keep the results going." }] },
    extras: ["split", "steps", "gallery"],
    cta: "Make time for yourself",
  },
  {
    key: "fitness",
    match: /gym|fitness|crossfit|personal train|bootcamp|martial|boxing|athlet/i,
    label: "Fitness",
    theme: "minimal",
    audience: "People who want to get stronger, fitter and stay consistent",
    tone: "Energetic, direct, motivating",
    goals: ["Convert visitors into trial members", "Explain programmes and pricing", "Show the community"],
    photoTags: ["fitness", "sport"],
    eyebrow: "Training club",
    heroHeading: (n) => `Stronger every week at ${n}.`,
    heroSub: "Coached classes, open gym and programmes that fit around real life.",
    primary: { label: "Start a free trial", target: "contact" },
    features: {
      heading: "Built for progress",
      sub: "",
      items: [
        { icon: "dumbbell", title: "Expert coaching", body: "Every session is led by a certified coach who knows your name." },
        { icon: "target", title: "Programmes that work", body: "Structured cycles so you always know what's next." },
        { icon: "users", title: "Real community", body: "Train alongside people who push you to show up." },
      ],
    },
    story: { eyebrow: "The club", heading: "No mirrors-and-selfies gym", body: "[Replace with your story] What kind of gym are you, and who is it for?", bullets: ["Beginner friendly", "Open 6am–10pm", "Showers and lockers"] },
    stats: [{ value: "40+", label: "Classes every week" }, { value: "6", label: "Coaches" }, { value: "1", label: "Free trial session" }],
    extras: ["stats", "split", "pricing"],
    cta: "Your first session is on us",
  },
  {
    key: "realestate",
    match: /real estate|realtor|property|properties|homes for sale|apartment|villa|letting|estate agent|interior design/i,
    label: "Real estate",
    theme: "minimal",
    audience: "Buyers, sellers and renters looking for a trusted local expert",
    tone: "Assured, polished, knowledgeable",
    goals: ["Generate qualified enquiries", "Showcase properties", "Establish local expertise"],
    photoTags: ["realestate", "architecture", "interior", "home"],
    eyebrow: "Homes & property",
    heroHeading: (n) => `Find the place you'll call home with ${n}.`,
    heroSub: "Local expertise, honest advice and a calm process from first viewing to keys in hand.",
    primary: { label: "Book a valuation", target: "contact" },
    features: {
      heading: "Why clients choose us",
      sub: "",
      items: [
        { icon: "house", title: "Local knowledge", body: "We live and work in the neighbourhoods we sell." },
        { icon: "handshake", title: "Straight talking", body: "Realistic prices and clear advice, even when it's not what you want to hear." },
        { icon: "camera", title: "Beautiful listings", body: "Professional photography and floor plans for every home." },
      ],
    },
    story: { eyebrow: "Featured", heading: "Light-filled homes, carefully chosen", body: "[Replace with a featured listing] Describe a property or the kind of homes you specialise in.", bullets: ["Free market appraisal", "Accompanied viewings", "Sales progression handled for you"] },
    steps: { heading: "How selling works", items: [{ title: "Free valuation", body: "A clear, evidence-based price for your home." }, { title: "Launch", body: "Photography, listing and targeted marketing." }, { title: "Sold", body: "We negotiate and manage everything to completion." }] },
    extras: ["gallery", "split", "steps"],
    cta: "Thinking of moving?",
  },
  {
    key: "store",
    match: /shop|store|e-?commerce|boutique|brand|products|merch|clothing|fashion|jewel/i,
    label: "Retail",
    theme: "minimal",
    audience: "Shoppers looking for well-made products",
    tone: "Stylish, confident, concise",
    goals: ["Showcase the collection", "Drive visits and enquiries", "Grow the mailing list"],
    photoTags: ["product", "store", "fashion"],
    eyebrow: "New collection",
    heroHeading: (n) => `${n}. Made to be used, loved and kept.`,
    heroSub: "Considered design, honest materials and pieces that last for years.",
    primary: { label: "View the collection", target: "gallery" },
    features: {
      heading: "Why shop with us",
      sub: "",
      items: [
        { icon: "gem", title: "Quality materials", body: "Chosen to last, sourced responsibly." },
        { icon: "truck", title: "Fast delivery", body: "Dispatched within two working days." },
        { icon: "heart", title: "Easy returns", body: "Thirty days to change your mind." },
      ],
    },
    story: { eyebrow: "Craft", heading: "Designed in small batches", body: "[Replace with your story] Explain how and where your products are made.", bullets: ["Limited runs", "Plastic-free packaging", "Repairs offered"] },
    extras: ["gallery", "split", "newsletter"],
    cta: "Join the list for early access",
  },
  {
    key: "saas",
    match: /saas|software|platform|startup|\bapp\b|tool|api|dashboard|product|automation|\bai\b/i,
    label: "Software",
    theme: "studio",
    audience: "Teams evaluating a software product",
    tone: "Clear, precise, credible",
    goals: ["Explain the product in one sentence", "Convert visitors to sign-ups", "Answer pricing questions"],
    photoTags: ["saas", "software", "tech", "data"],
    eyebrow: "Now in public beta",
    heroHeading: (n) => `${n} helps your team ship more with less effort.`,
    heroSub: "Replace scattered tools and manual busywork with one calm, connected workspace.",
    primary: { label: "Start free", target: "pricing" },
    features: {
      heading: "Everything your team needs, nothing it doesn't",
      sub: "Powerful where it matters, invisible everywhere else.",
      items: [
        { icon: "zap", title: "Set up in minutes", body: "Import your data and invite the team before your coffee cools." },
        { icon: "layers", title: "Works with your stack", body: "Connects to the tools you already use." },
        { icon: "shield", title: "Secure by default", body: "Role-based access, audit history and encryption at rest." },
        { icon: "chart", title: "Insight built in", body: "See what's working with dashboards that update in real time." },
        { icon: "magic", title: "Automate the boring parts", body: "Rules and workflows that run while you focus." },
      ],
    },
    story: { eyebrow: "How it works", heading: "One place for the work that matters", body: "[Replace with your product story] Explain the problem you solve and the moment your customers realise they need you.", bullets: ["No credit card required", "Cancel anytime", "Free for small teams"] },
    steps: { heading: "Up and running in three steps", items: [{ title: "Connect", body: "Link your existing tools in a few clicks." }, { title: "Configure", body: "Pick a template or build your own workflow." }, { title: "Collaborate", body: "Invite your team and work from one source of truth." }] },
    stats: [{ value: "10×", label: "Faster reporting" }, { value: "99.9%", label: "Uptime" }, { value: "4.8/5", label: "Average rating" }],
    extras: ["logos", "split", "steps", "stats"],
    cta: "Ready when you are",
  },
  {
    key: "portfolio",
    match: /portfolio|photograph|designer|artist|illustrat|freelanc|personal site|resume|\bcv\b|architect|studio/i,
    label: "Portfolio",
    theme: "minimal",
    audience: "Prospective clients and collaborators",
    tone: "Confident, understated",
    goals: ["Show selected work", "Explain services", "Get enquiries"],
    photoTags: ["portfolio", "design", "workspace", "interior", "architecture"],
    eyebrow: "Independent studio",
    heroHeading: (n) => `${n} — design with intent.`,
    heroSub: "Identity, digital and print for people building thoughtful things.",
    primary: { label: "Start a project", target: "contact" },
    features: {
      heading: "Services",
      sub: "",
      items: [
        { icon: "palette", title: "Brand identity", body: "Names, logos and systems that feel inevitable." },
        { icon: "code", title: "Digital design", body: "Websites and products that are a pleasure to use." },
        { icon: "camera", title: "Art direction", body: "Photography and campaigns with a point of view." },
      ],
    },
    story: { eyebrow: "About", heading: "Small studio, close collaboration", body: "[Replace with your bio] Who you are, how you work and the kind of projects you love.", bullets: ["Available from next month", "Remote-friendly", "Fixed-price projects"] },
    extras: ["gallery", "split"],
    cta: "Have a project in mind?",
  },
  {
    key: "consulting",
    match: /consult|agency|law|legal|accountant|advis|clinic|dental|firm|services|coach/i,
    label: "Professional services",
    theme: "fresh",
    audience: "Businesses and individuals looking for expert help",
    tone: "Trustworthy, expert, approachable",
    goals: ["Build trust", "Explain services", "Generate qualified enquiries"],
    photoTags: ["consulting", "business", "office"],
    eyebrow: "Advisory",
    heroHeading: (n) => `${n}: expert help when it matters.`,
    heroSub: "Clear advice, a fixed plan and a team that answers the phone.",
    primary: { label: "Book a consultation", target: "contact" },
    features: {
      heading: "How we help",
      sub: "",
      items: [
        { icon: "briefcase", title: "Strategy", body: "Understand where you are and decide where to go next." },
        { icon: "chart", title: "Growth", body: "Practical plans with measurable milestones." },
        { icon: "shield", title: "Risk & compliance", body: "Stay ahead of the rules that affect your business." },
      ],
    },
    story: { eyebrow: "Why us", heading: "Senior attention on every engagement", body: "[Replace with your story] Describe your experience and the clients you serve best.", bullets: ["Free first consultation", "Fixed-fee options", "Responses within one working day"] },
    steps: { heading: "Working together", items: [{ title: "Discovery call", body: "A free conversation to understand your situation." }, { title: "Clear proposal", body: "Scope, timeline and price in writing." }, { title: "Ongoing support", body: "We stay available after the work is done." }] },
    stats: [{ value: "15+", label: "Years of experience" }, { value: "300", label: "Clients advised" }, { value: "24h", label: "Response time" }],
    extras: ["logos", "steps", "stats", "split"],
    cta: "Let's talk about your goals",
  },
  {
    key: "education",
    match: /school|course|tutor|academy|learning|education|class|workshop|training/i,
    label: "Education",
    theme: "fresh",
    audience: "Learners and parents looking for quality teaching",
    tone: "Encouraging, clear, credible",
    goals: ["Drive enrolments", "Explain courses", "Build trust with parents and learners"],
    photoTags: ["education", "people"],
    eyebrow: "Learning",
    heroHeading: (n) => `Learn with confidence at ${n}.`,
    heroSub: "Small groups, expert teachers and a curriculum that adapts to every learner.",
    primary: { label: "Enrol now", target: "contact" },
    features: {
      heading: "Learning that sticks",
      sub: "",
      items: [
        { icon: "education", title: "Expert teachers", body: "Qualified, experienced and genuinely enthusiastic." },
        { icon: "users", title: "Small groups", body: "Every learner gets attention and feedback." },
        { icon: "award", title: "Real progress", body: "Regular check-ins so you can see how far you've come." },
      ],
    },
    story: { eyebrow: "Our approach", heading: "Curious minds, practical skills", body: "[Replace with your story] Describe your teaching philosophy.", bullets: ["Free trial lesson", "Online and in person", "Flexible schedules"] },
    steps: { heading: "Getting started", items: [{ title: "Free assessment", body: "We find the right level and goals." }, { title: "Join a group", body: "Pick a schedule that works for you." }, { title: "Track progress", body: "Regular feedback and reports." }] },
    extras: ["steps", "split", "faq"],
    cta: "Start learning this week",
  },
];

const GENERIC: Industry = {
  key: "general",
  match: /.^/,
  label: "Business",
  theme: "minimal",
  audience: "Prospective customers",
  tone: "Clear and professional",
  goals: ["Explain the offer", "Build trust", "Generate enquiries"],
  photoTags: ["business", "office", "workspace"],
  eyebrow: "",
  heroHeading: (n) => `Welcome to ${n}`,
  heroSub: "Describe what you offer and who it is for in one or two sentences.",
  primary: { label: "Get in touch", target: "contact" },
  features: {
    heading: "What we offer",
    sub: "",
    items: [
      { icon: "sparkles", title: "What you offer", body: "Describe your main product or service." },
      { icon: "star", title: "Why it is different", body: "Say what makes you the better choice." },
      { icon: "check", title: "How to start", body: "Tell visitors the next step." },
    ],
  },
  story: { eyebrow: "About", heading: "Who we are", body: "[Replace with your story] Tell visitors who you are and why you do this.", bullets: [] },
  extras: ["split"],
  cta: "Let's work together",
};

export const industryFor = (label: string) => [...INDUSTRIES, GENERIC].find((i) => i.label === label) ?? GENERIC;

const has = (text: string, re: RegExp) => re.test(text);

function extractName(text: string): string {
  const quoted = text.match(/["“']([^"”']{2,60})["”']/);
  if (quoted) return quoted[1].trim();
  const called = text.match(/(?:called|named)\s+([A-Z][\w&' -]{1,40}?)(?=[,.]|\s+(?:with|in|that|which|for)\b|$)/);
  if (called) return called[1].trim();
  return "";
}

const BOOKING_COPY: Record<string, { heading: string; body: string; button: string; party: number }> = {
  restaurant: { heading: "Book a table", body: "Send a request and we will confirm by phone or email.", button: "Request booking", party: 12 },
  hotel: { heading: "Check availability", body: "Tell us your dates and we will confirm availability and rates by email.", button: "Request dates", party: 6 },
  clinic: { heading: "Book an appointment", body: "Choose a time that suits you; we will confirm by phone or SMS. For emergencies, call us directly.", button: "Request appointment", party: 2 },
  petcare: { heading: "Book a visit", body: "Tell us about your pet and a time that suits; we will confirm shortly.", button: "Request visit", party: 3 },
  automotive: { heading: "Book a service", body: "Pick a day and tell us about the car; we will confirm and quote first.", button: "Request service", party: 1 },
  jewellery: { heading: "Book a private viewing", body: "Visit the studio by appointment, or ask about a bespoke piece.", button: "Request viewing", party: 4 },
  default: { heading: "Request an appointment", body: "Tell us when suits you and we will confirm by phone or email.", button: "Request appointment", party: 5 },
};

const GALLERY_HEADING: Record<string, string> = {
  store: "The collection",
  fashion: "The collection",
  jewellery: "The collection",
  portfolio: "Selected work",
  photography: "Selected work",
  architecture: "Selected projects",
  hotel: "Rooms & spaces",
  wedding: "Recent celebrations",
  petcare: "Happy regulars",
  travel: "Where we go",
  music: "On stage",
};

const plan = (name: string, price: string, period: string, features: string[], highlighted = false, ctaLabel = "Enquire") => ({ name, price, period, features, ctaLabel, ctaHref: "#contact", highlighted });
const PLANS: Record<string, { heading: string; plans: ReturnType<typeof plan>[] }> = {
  photography: { heading: "Packages", plans: [plan("Portrait", "₹15,000", "", ["2-hour session", "40 edited images", "Online gallery"]), plan("Wedding day", "₹1,20,000", "", ["Full-day coverage", "500+ edited images", "Second shooter"], true), plan("Brand", "₹35,000", "", ["Half-day shoot", "Commercial licence", "Social crops"])] },
  finance: { heading: "Simple monthly plans", plans: [plan("Essentials", "₹4,999", "/month", ["Bookkeeping", "GST filings", "Quarterly review"]), plan("Growth", "₹12,999", "/month", ["Everything in Essentials", "Payroll", "Monthly management reports"], true), plan("Advisory", "Custom", "", ["Part-time CFO", "Fundraising support", "Board reporting"])] },
  automotive: { heading: "Service menu", plans: [plan("Basic service", "₹2,499", "", ["Oil and filter", "Safety check", "Fluid top-up"]), plan("Full service", "₹5,999", "", ["Everything in Basic", "Brakes and suspension check", "Diagnostics scan"], true), plan("Premium detail", "₹7,999", "", ["Exterior polish", "Interior deep clean", "Ceramic protection"])] },
};

/** Turns a plain-language brief into a structured spec, without an LLM. */
export function planFromBrief(brief: string, opts: { name?: string } = {}): ProjectSpec {
  const text = brief.trim();
  const industry = INDUSTRIES.find((i) => i.match.test(text)) ?? GENERIC;
  const name = opts.name?.trim() || extractName(text) || `My ${industry.label.toLowerCase()}`;

  const wants = {
    reservations: has(text, /reserv|booking|book a|appointment|table/i) || industry.primary.target === "booking",
    menu: has(text, /menu|dishes|price list/i) || ["restaurant", "cafe"].includes(industry.key),
    reviews: has(text, /review|testimonial/i),
    whatsapp: has(text, /whats ?app/i),
    pricing: has(text, /pricing|plans|subscription|membership/i) || industry.extras.includes("pricing") || industry.key === "saas",
    faq: has(text, /faq|questions/i) || ["saas", "education"].includes(industry.key) || industry.extras.includes("faq"),
    gallery: has(text, /gallery|photos|portfolio|(?<!how it )\bwork\b|collection/i) || industry.extras.includes("gallery"),
    team: has(text, /team|staff|our people|coaches|teachers/i),
    newsletter: has(text, /newsletter|mailing list|subscribe/i) || industry.extras.includes("newsletter"),
    admin: has(text, /admin|dashboard|manage/i),
  };

  // Section order follows a conversion narrative: promise → proof → detail → action.
  const home: Section["type"][] = ["navbar", "hero"];
  if (industry.extras.includes("logos")) home.push("logos");
  home.push("features");
  if (industry.extras.includes("split")) home.push("split");
  if (industry.extras.includes("stats")) home.push("stats");
  if (wants.menu) home.push("menu");
  if (industry.extras.includes("steps")) home.push("steps");
  if (wants.gallery) home.push("gallery");
  if (wants.team) home.push("team");
  if (wants.reviews) home.push("testimonials");
  if (wants.pricing) home.push("pricing");
  if (wants.faq) home.push("faq");
  if (wants.reservations) home.push("booking");
  else home.push("cta");
  if (wants.newsletter) home.push("newsletter");
  home.push("contact", "footer");

  const pages: ProjectSpec["pages"] = [{ path: "/", title: name, purpose: "Introduce the business and drive the primary action", sections: home }];
  pages.push({ path: "/about", title: "About", purpose: "Tell the story and build trust", sections: ["navbar", "hero", "text", "split", "cta", "footer"] });

  const whatsapp = (text.match(/\+?\d[\d\s-]{8,16}\d/)?.[0] ?? "").replace(/\D/g, "");
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";

  const dataModels: ProjectSpec["dataModels"] = [];
  const integrations: ProjectSpec["integrations"] = [];
  if (wants.reservations) {
    dataModels.push({ name: "Reservation", fields: ["name", "contact", "date", "time", "guests", "notes", "status"], purpose: "Booking requests from the website form" });
  }
  dataModels.push({ name: "Enquiry", fields: ["name", "email", "message", "createdAt"], purpose: "Messages from the contact form" });
  if (wants.newsletter) dataModels.push({ name: "Subscriber", fields: ["email", "createdAt"], purpose: "Newsletter sign-ups" });
  if (wants.whatsapp) integrations.push({ provider: "WhatsApp click-to-chat", purpose: "Let visitors open a WhatsApp chat (link only, no API)", required: false });
  if (wants.reviews) integrations.push({ provider: "Reviews source", purpose: "Real reviews must be supplied; none are generated", required: false });

  const questions: ProjectSpec["questions"] = [];
  if (!opts.name && !extractName(text)) questions.push({ id: "name", question: "What is the business called?", why: "Used in the navigation, page titles and copy." });
  if (wants.whatsapp && !whatsapp) questions.push({ id: "whatsapp", question: "Which WhatsApp number should visitors message?", why: "Needed for the click-to-chat link." });
  if (wants.reviews) questions.push({ id: "reviews", question: "Can you share two or three real customer reviews?", why: "Placeholder quotes are inserted until real ones are added; reviews are never invented." });
  if (wants.menu) questions.push({ id: "menu", question: "Do you have your current menu with prices?", why: "The menu section starts with example items you will need to replace." });

  const personality = suggestPersonality(industry.label, text);
  const assumptions = [
    `Treated this as a ${industry.label.toLowerCase()} website with a “${personality}” design direction.`,
    "Photos are high-quality placeholders; replace them with your own before launch.",
    "Forms store submissions in the platform; email notifications need a mail provider to be connected.",
    wants.admin ? "The admin panel is the platform's submissions inbox for this project; a custom admin app is not generated yet." : "",
  ].filter(Boolean);

  return {
    name,
    summary: text.slice(0, 1000),
    kind: industry.key === "portfolio" ? "portfolio" : industry.key === "saas" ? "landing" : "website",
    industry: industry.label,
    audience: industry.audience,
    goals: industry.goals,
    tone: industry.tone,
    themePreset: industry.theme,
    personality,
    designSeed: 0,
    pages,
    contact: { email, phone: "", whatsapp, address: "" },
    dataModels,
    integrations,
    questions,
    assumptions,
  };
}

/** The design directions to offer for a spec, best match first. */
export function designChoices(spec: ProjectSpec): string[] {
  const choices = directionChoices(spec.industry, spec.summary);
  if (spec.personality && !choices.includes(spec.personality)) return [spec.personality, ...choices.slice(0, 2)];
  return spec.personality ? [spec.personality, ...choices.filter((c) => c !== spec.personality)] : choices;
}

/** Builds a site document from an approved spec. Deterministic. */
export function composeSite(spec: ProjectSpec, opts: { personality?: string; seed?: number } = {}): SiteDoc {
  const industry = industryFor(spec.industry);
  const personalityId = opts.personality ?? spec.personality ?? suggestPersonality(spec.industry, spec.summary);
  const seed = opts.seed ?? spec.designSeed ?? 0;
  const photos = pickPhotos(industry.photoTags, 9, seed);
  const photo = (i: number, w = 1800) => (photos[i % photos.length] ? photoUrl(photos[i % photos.length].id, w) : "");
  const alt = (i: number) => photos[i % photos.length]?.alt ?? "";

  const homeHas = (t: string) => spec.pages[0].sections.includes(t);
  const hasAbout = spec.pages.some((p) => p.path === "/about");
  const anchor = (t: Industry["primary"]["target"]) => (homeHas(t) ? `/#${t}` : "/#contact");
  const primary = homeHas(industry.primary.target) || industry.primary.target === "contact" ? { label: industry.primary.label, href: anchor(industry.primary.target) } : { label: "Get in touch", href: "/#contact" };
  const isRestaurant = industry.key === "restaurant";
  const booking = BOOKING_COPY[industry.key] ?? (isRestaurant ? BOOKING_COPY.restaurant : BOOKING_COPY.default);
  const bookingLabel = booking.heading;

  const navLinks: { label: string; href: string }[] = [];
  if (homeHas("menu")) navLinks.push({ label: "Menu", href: "/#menu" });
  if (homeHas("gallery")) navLinks.push({ label: ["store", "fashion", "jewellery"].includes(industry.key) ? "Collection" : ["portfolio", "photography", "architecture"].includes(industry.key) ? "Work" : "Gallery", href: "/#gallery" });
  if (homeHas("pricing")) navLinks.push({ label: "Pricing", href: "/#pricing" });
  for (const p of spec.pages.filter((p) => p.path !== "/")) navLinks.push({ label: p.title, href: p.path });
  navLinks.push({ label: "Contact", href: "/#contact" });

  let splitCount = 0;
  const pages: Page[] = spec.pages.map((ps) => {
    const isHome = ps.path === "/";
    const sections = ps.sections.map((type) => {
      const s = createSection(type);
      const p = s.props;
      switch (type) {
        case "navbar":
          Object.assign(p, { brand: spec.name, links: navLinks.slice(0, 5), ctaLabel: primary.label, ctaHref: primary.href });
          break;
        case "hero":
          if (isHome) {
            Object.assign(p, {
              eyebrow: industry.eyebrow,
              // "Waggle & Co." + ". Happy pets" must not become "Co.. Happy".
              heading: industry.heroHeading(spec.name.replace(/[.!?]+$/, "")),
              subheading: industry.heroSub,
              primaryLabel: primary.label,
              primaryHref: primary.href,
              secondaryLabel: homeHas("menu") ? "View the menu" : homeHas("gallery") ? (["portfolio", "photography", "architecture"].includes(industry.key) ? "See our work" : ["store", "fashion", "jewellery"].includes(industry.key) ? "Shop the collection" : "Take a look inside") : hasAbout ? "Learn more" : "",
              secondaryHref: homeHas("menu") ? "/#menu" : homeHas("gallery") ? "/#gallery" : hasAbout ? "/about" : "",
              image: photo(0, 2000),
              imageAlt: alt(0),
            });
          } else {
            Object.assign(p, { eyebrow: spec.name, heading: ps.title === "About" ? `The story behind ${spec.name}` : ps.title, subheading: ps.purpose, primaryLabel: "", secondaryLabel: "", image: photo(4, 2000), imageAlt: alt(4) });
            s.style.paddingY = "sm";
          }
          break;
        case "logos":
          Object.assign(p, { heading: "Trusted by teams at", items: ["[Client one]", "[Client two]", "[Client three]", "[Client four]", "[Client five]"].map((name) => ({ name })) });
          break;
        case "features":
          Object.assign(p, { heading: industry.features.heading, subheading: industry.features.sub, items: industry.features.items });
          break;
        case "split": {
          const i = splitCount++;
          Object.assign(p, {
            eyebrow: i === 0 ? industry.story.eyebrow : "Behind the scenes",
            heading: i === 0 ? industry.story.heading : "The people who make it happen",
            body: i === 0 ? industry.story.body : `[Replace with details] Introduce the people behind ${spec.name} and what they care about.`,
            bullets: i === 0 ? industry.story.bullets : [],
            image: photo(1 + i * 2, 1400),
            imageAlt: alt(1 + i * 2),
            buttonLabel: i === 0 && isHome && hasAbout ? "Our story" : "",
            buttonHref: "/about",
          });
          s.variant = i % 2 === 0 ? "image-left" : "image-right";
          break;
        }
        case "stats":
          Object.assign(p, { heading: "", subheading: "", items: industry.stats ?? [], _example: true });
          break;
        case "steps":
          Object.assign(p, { heading: industry.steps?.heading ?? "How it works", subheading: "", items: industry.steps?.items ?? [] });
          break;
        case "text":
          Object.assign(p, {
            heading: "Our story",
            body: `[Replace with your story] Explain how ${spec.name} started, what you care about, and who is behind it.\n\nKeep it to two or three short paragraphs; specifics beat superlatives.`,
          });
          break;
        case "menu":
          Object.assign(p, {
            heading: "Menu",
            subheading: "Example items — replace them with your current menu.",
            currency: "₹",
            categories: [
              { name: "Small plates", items: [{ name: "[Add dish]", description: "Short, appetising description", price: "0" }, { name: "[Add dish]", description: "Short, appetising description", price: "0" }] },
              { name: "Mains", items: [{ name: "[Add dish]", description: "Short, appetising description", price: "0" }, { name: "[Add dish]", description: "Short, appetising description", price: "0" }] },
            ],
          });
          break;
        case "gallery":
          Object.assign(p, {
            heading: GALLERY_HEADING[industry.key] ?? "A look inside",
            // Only on-topic photos; with fewer matches the gallery is simply shorter.
            images: (photos.length > 4 ? photos.slice(2) : photos).slice(0, 6).map((ph) => ({ src: photoUrl(ph.id, 1200), alt: ph.alt })),
          });
          break;
        case "testimonials":
          Object.assign(p, { heading: "What people say", items: [{ quote: "[Replace with a real customer quote]", author: "[Customer name]", role: "" }, { quote: "[Replace with a real customer quote]", author: "[Customer name]", role: "" }, { quote: "[Replace with a real customer quote]", author: "[Customer name]", role: "" }] });
          break;
        case "pricing":
          if (PLANS[industry.key]) {
            Object.assign(p, { heading: PLANS[industry.key].heading, subheading: "Example prices — set your own.", plans: PLANS[industry.key].plans });
          } else if (industry.key === "fitness") {
            Object.assign(p, { heading: "Memberships", subheading: "Example prices — set your own.", plans: [
              { name: "Off-peak", price: "₹1,999", period: "/month", features: ["Weekday daytime access", "2 classes a week"], ctaLabel: "Choose", ctaHref: "#contact", highlighted: false },
              { name: "Unlimited", price: "₹3,499", period: "/month", features: ["24/7 access", "Unlimited classes", "Programme check-ins"], ctaLabel: "Choose", ctaHref: "#contact", highlighted: true },
              { name: "Coaching", price: "₹8,999", period: "/month", features: ["Everything in Unlimited", "Weekly 1:1 coaching", "Nutrition plan"], ctaLabel: "Choose", ctaHref: "#contact", highlighted: false },
            ] });
          } else {
            Object.assign(p, { heading: "Simple, transparent pricing", subheading: "Example prices — set your own.", plans: [
              { name: "Starter", price: "₹0", period: "/month", features: ["Up to 3 users", "Core features", "Community support"], ctaLabel: "Start free", ctaHref: "#contact", highlighted: false },
              { name: "Team", price: "₹1,499", period: "/user/month", features: ["Unlimited users", "Automations", "Priority support"], ctaLabel: "Start trial", ctaHref: "#contact", highlighted: true },
              { name: "Enterprise", price: "Custom", period: "", features: ["SSO and audit logs", "Dedicated success manager", "Custom contracts"], ctaLabel: "Talk to us", ctaHref: "#contact", highlighted: false },
            ] });
          }
          break;
        case "faq":
          Object.assign(p, { heading: "Questions, answered", items: [
            { question: "How do I get started?", answer: `Get in touch through the form below and the ${spec.name} team will reply within one working day.` },
            { question: "What does it cost?", answer: "[Replace with your answer] Explain pricing or where to find it." },
            { question: "Where are you based?", answer: "[Replace with your answer] Add your location and service area." },
          ] });
          break;
        case "booking":
          Object.assign(p, {
            heading: bookingLabel,
            body: booking.body,
            buttonLabel: booking.button,
            maxPartySize: booking.party,
          });
          break;
        case "newsletter":
          Object.assign(p, { heading: industry.key === "store" ? "Be first to the next drop" : "Stay in the loop", body: "News, offers and the occasional behind-the-scenes. Once a month, unsubscribe anytime.", buttonLabel: "Subscribe" });
          break;
        case "contact":
          Object.assign(p, {
            heading: "Visit or get in touch",
            body: "We usually reply within one working day.",
            email: spec.contact.email,
            phone: spec.contact.phone,
            whatsapp: spec.contact.whatsapp,
            address: spec.contact.address,
            showForm: true,
          });
          break;
        case "cta":
          Object.assign(p, { heading: industry.cta, body: "", buttonLabel: primary.label, buttonHref: primary.href });
          break;
        case "footer":
          Object.assign(p, { text: `© ${new Date().getFullYear()} ${spec.name.replace(/[.!?]+$/, "")}. All rights reserved.`, links: navLinks.slice(0, 5) });
          break;
      }
      return s;
    });
    return {
      id: newId("p"),
      path: ps.path,
      title: ps.title,
      kind: "page" as const,
      // Written for search results, never the user's private brief.
      description: (isHome ? `${spec.name.replace(/[.!?]+$/, "")}. ${industry.heroSub}` : `${ps.title} — ${spec.name.replace(/[.!?]+$/, "")}. ${ps.purpose}`).slice(0, 160),
      sections,
    };
  });

  const draft = { version: 1 as const, name: spec.name, lang: "en", theme: undefined as unknown as SiteDoc["theme"], pages };
  applyPersonality(draft as SiteDoc, personalityId, seed);
  return siteDocSchema.parse(draft);
}

export function composeSiteJson(spec: ProjectSpec, opts: { personality?: string; seed?: number } = {}): string {
  return serializeSiteDoc(composeSite(spec, opts));
}
