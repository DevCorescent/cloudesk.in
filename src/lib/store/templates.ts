// Store starter templates: a storefront design plus a sample catalog per
// kind of business. Sample products are marked isSample in the database and
// cannot be bought until the owner replaces or confirms them.
import { applyLayout, themeFor } from "../site/design";
import { photoUrl } from "../site/media";
import type { SiteUi } from "../site/advanced";
import { createSection, newId, siteDocSchema, type Section, type SiteDoc } from "../site/model";

export type SampleProduct = {
  title: string;
  description: string;
  /** Price in Indian rupees (major units); converted for other currencies. */
  inr: number;
  compareInr?: number;
  photo: string;
  collection: number;
  options?: { name: string; values: string[] };
  stock?: number;
  featured?: boolean;
  weightGrams?: number;
};

export type StoreTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  storeName: string;
  personality: string;
  palette: string;
  accent: string;
  /** Hero photo id (Unsplash, verified on-topic and unbranded). */
  image: string;
  storyImage: string;
  eyebrow: string;
  heading: string;
  sub: string;
  announcement: string;
  story: { eyebrow: string; heading: string; body: string; bullets: string[] };
  promises: { icon: string; title: string; body: string }[];
  collections: { title: string; description: string; photo: string }[];
  products: SampleProduct[];
  faq: { question: string; answer: string }[];
  /** A signature storefront design (modern templates). Without it the classic layout is used. */
  look?: StoreLook;
};

/**
 * A modern storefront recipe, applied after the personality's layout pass:
 * a full-bleed or editorial hero, a moving ticker, an editorial product grid,
 * a photo lookbook and a dark story band, with its own fonts and header.
 */
export type StoreLook = {
  fontPair: string;
  /** Keep header "transparent" for dark palettes only: on light ones its text sits dark-on-dark over a photo hero. */
  ui?: SiteUi;
  hero: "overlay" | "editorial" | "centered" | "split" | "minimal";
  heroDecor?: "none" | "mesh" | "glow" | "grain" | "grid" | "dots" | "gradient";
  ticker: { items: string[]; variant: "bold" | "outline" | "subtle" };
  /** Photo ids for the lookbook (masonry gallery). */
  lookbook: { heading: string; photos: { id: string; alt: string }[] };
  /** The story band in reverse colours. */
  darkStory?: boolean;
  /** Part of the glass collection: frosted panels, so story and promise bands stay translucent. */
  glass?: boolean;
};

const SHIPPING_PROMISES = (extra: { icon: string; title: string; body: string }) => [
  { icon: "truck", title: "Fast, tracked delivery", body: "Orders leave within 1–2 business days with tracking on every parcel." },
  { icon: "lock", title: "Secure checkout", body: "UPI, cards and wallets through trusted payment partners, or cash on delivery." },
  extra,
];

const COMMON_FAQ = [
  { question: "How long does delivery take?", answer: "[Edit to match your shipping] Most orders arrive in 3–6 business days. You will get a tracking link by email as soon as your parcel ships." },
  { question: "Do you offer cash on delivery?", answer: "[Edit to match your settings] Yes, cash on delivery is available on most orders. Online payments are confirmed instantly." },
  { question: "How do I track my order?", answer: "Use the Track order page with your order number and email address, or follow the link in your shipping email." },
];

const SIZES = { name: "Size", values: ["S", "M", "L", "XL"] };

type GlassSpec = {
  id: string; name: string; category: string; storeName: string; palette: string; accent: string; fontPair: string;
  hero: StoreLook["hero"]; heroDecor?: StoreLook["heroDecor"];
  description: string; image: string; storyImage: string; eyebrow: string; heading: string; sub: string; announcement: string;
  story: StoreTemplate["story"]; extra: { icon: string; title: string; body: string };
  collections: [string, string, string][];
  /** title, description, price (INR), photo, collection, compare-at, featured-only, options */
  products: [string, string, number, string, number, (number | null)?, boolean?, [string, string[]]?][];
  ticker: string[]; lookbook: [string, [string, string][]]; faq: [string, string];
};

/** A template in the glass collection: frosted panels over soft colour light, with a signature layout. */
function glassTemplate(g: GlassSpec): StoreTemplate {
  return {
    id: g.id, name: g.name, category: g.category, description: g.description, storeName: g.storeName,
    personality: "glass", palette: g.palette, accent: g.accent, image: g.image, storyImage: g.storyImage,
    eyebrow: g.eyebrow, heading: g.heading, sub: g.sub, announcement: g.announcement, story: g.story,
    promises: SHIPPING_PROMISES(g.extra),
    collections: g.collections.map(([title, description, photo]) => ({ title, description, photo })),
    products: g.products.map(([title, description, inr, photo, collection, compareInr, , opt], i) => ({
      title, description, inr, photo, collection, ...(compareInr ? { compareInr } : {}), ...(opt ? { options: { name: opt[0], values: opt[1] } } : {}),
      featured: i < 4, stock: 12 + ((i * 7) % 13), weightGrams: 500,
    })),
    faq: [...COMMON_FAQ, { question: g.faq[0], answer: g.faq[1] }],
    look: {
      fontPair: g.fontPair, glass: true,
      ui: { header: "glass", buttonSize: "lg" },
      hero: g.hero, heroDecor: g.heroDecor,
      ticker: { items: g.ticker, variant: "bold" },
      lookbook: { heading: g.lookbook[0], photos: g.lookbook[1].map(([id, alt]) => ({ id, alt })) },
      darkStory: false,
    },
  };
}

export const STORE_TEMPLATES: StoreTemplate[] = [
  {
    id: "fashion",
    name: "Fashion & apparel",
    category: "Clothing",
    description: "Editorial lookbook styling with sizes, collections and new arrivals.",
    storeName: "Thread & Loom",
    personality: "editorial",
    palette: "paper",
    accent: "#111111",
    image: "1490481651871-ab68de25d43d",
    storyImage: "1441986300917-64674bd600d8",
    eyebrow: "New season",
    heading: "Everyday pieces, made to last",
    sub: "Considered essentials in natural fabrics — cut for comfort, finished with care, and priced fairly.",
    announcement: "Free shipping on orders over ₹999 · Easy 7-day returns",
    story: { eyebrow: "Our approach", heading: "Fewer, better clothes", body: "[Replace with your story] We design in small runs, work with mills we know by name, and skip the trend cycle in favour of pieces you will reach for every week.", bullets: ["Natural and recycled fabrics", "Made in small batches", "Fair pricing, no inflated discounts"] },
    promises: SHIPPING_PROMISES({ icon: "heart", title: "Size help", body: "Unsure about fit? Message us and we will help you choose." }),
    collections: [
      { title: "Tops & tees", description: "Knits, tees and shirts for every day.", photo: "1523381210434-271e8be1f52b" },
      { title: "Outerwear", description: "Layers for cooler days.", photo: "1591047139829-d91aecb6caea" },
      { title: "Accessories", description: "Bags and finishing touches.", photo: "1622560480605-d83c853bc5c3" },
    ],
    products: [
      { title: "Open-knit summer top", description: "A loose, airy knit in soft cotton yarn. Wear it over a tank or swimwear.", inr: 1899, compareInr: 2499, photo: "1434389677669-e08b4cac3105", collection: 0, options: SIZES, featured: true, weightGrams: 300 },
      { title: "Graphic print tee", description: "Heavyweight 220 GSM cotton with a screen-printed front. Relaxed fit.", inr: 999, photo: "1576566588028-4147f3842f27", collection: 0, options: SIZES, featured: true, weightGrams: 250 },
      { title: "Classic bomber jacket", description: "Lightweight bomber with ribbed cuffs and a smooth zip. Fully lined.", inr: 3999, compareInr: 4999, photo: "1591047139829-d91aecb6caea", collection: 1, options: SIZES, featured: true, weightGrams: 800 },
      { title: "Everyday leather backpack", description: "Soft vegetable-tanned leather, padded laptop sleeve and two outer pockets.", inr: 4499, photo: "1622560480605-d83c853bc5c3", collection: 2, featured: true, weightGrams: 1200 },
      { title: "Essential crew tee", description: "Our softest everyday tee, garment-dyed for a lived-in colour.", inr: 799, photo: "1523381210434-271e8be1f52b", collection: 0, options: SIZES, weightGrams: 220 },
      { title: "Co-ord track set", description: "Brushed-back jogger and matching top in a bold seasonal colour.", inr: 2999, photo: "1515886657613-9f3515b0c78f", collection: 0, options: SIZES, weightGrams: 700 },
      { title: "Winter knit bundle", description: "Rib-knit beanie and matching scarf — a ready-made gift.", inr: 1499, photo: "1556905055-8f358a7a47b2", collection: 2, weightGrams: 400 },
    ],
    faq: [...COMMON_FAQ, { question: "How do I pick my size?", answer: "[Add your size guide] Our pieces follow standard sizing. If you are between sizes, size up for a relaxed fit." }],
  },
  {
    id: "jewellery",
    name: "Jewellery",
    category: "Luxury",
    description: "Dark, luxurious styling for fine and demi-fine jewellery.",
    storeName: "Aurelia",
    personality: "luxury",
    palette: "midnight",
    accent: "#e3cf9f",
    image: "1599643478518-a784e5dc4c8f",
    storyImage: "1606760227091-3dd870d97f1d",
    eyebrow: "Fine jewellery",
    heading: "Pieces to keep, and pass on",
    sub: "Hand-finished necklaces, bracelets and earrings in gold vermeil, sterling silver and freshwater pearl.",
    announcement: "Complimentary gift box with every order",
    story: { eyebrow: "The atelier", heading: "Hand-finished, one piece at a time", body: "[Replace with your story] Every piece is polished, set and checked by hand in our studio before it is boxed for you.", bullets: ["Hallmarked metals", "Nickel-free and skin-safe", "Lifetime cleaning and care"] },
    promises: SHIPPING_PROMISES({ icon: "gem", title: "Certified quality", body: "Hallmarked metals with a certificate of authenticity." }),
    collections: [
      { title: "Necklaces", description: "Pendants, chains and pearls.", photo: "1515562141207-7a88fb7ce338" },
      { title: "Bracelets", description: "Bangles and delicate links.", photo: "1611591437281-460bfbe1220a" },
      { title: "Earrings & rings", description: "Hoops, studs and stacking rings.", photo: "1617038260897-41a1f14a8ca0" },
    ],
    products: [
      { title: "Freshwater pearl necklace", description: "A single strand of hand-knotted freshwater pearls with a gold vermeil clasp.", inr: 8999, photo: "1515562141207-7a88fb7ce338", collection: 0, featured: true, stock: 6, weightGrams: 100 },
      { title: "Sapphire-blue drop pendant", description: "A faceted blue stone on a fine 18-inch gold-plated chain.", inr: 5499, compareInr: 6499, photo: "1599643478518-a784e5dc4c8f", collection: 0, featured: true, stock: 8, weightGrams: 80 },
      { title: "Rose-gold filigree bracelet", description: "Delicate filigree links in rose-gold plated sterling silver.", inr: 4299, photo: "1611591437281-460bfbe1220a", collection: 1, options: { name: "Size", values: ["Petite", "Regular"] }, featured: true, stock: 10, weightGrams: 80 },
      { title: "Sculpted gold hoop set", description: "Two pairs of chunky, hollow hoops — light enough to wear all day.", inr: 3499, photo: "1617038260897-41a1f14a8ca0", collection: 2, featured: true, stock: 12, weightGrams: 60 },
      { title: "Sterling silver stacking set", description: "A curated stack of sterling rings and chains, ready to mix and layer.", inr: 6999, photo: "1606760227091-3dd870d97f1d", collection: 2, stock: 5, weightGrams: 120 },
    ],
    faq: [...COMMON_FAQ, { question: "How do I care for my jewellery?", answer: "Store pieces separately, avoid perfume and water, and polish gently with a soft cloth." }],
  },
  {
    id: "beauty",
    name: "Beauty & skincare",
    category: "Beauty",
    description: "Soft, organic styling for skincare, makeup and handmade cosmetics.",
    storeName: "Botanica",
    personality: "organic",
    palette: "blush",
    accent: "#7a2a52",
    image: "1612817288484-6f916006741a",
    storyImage: "1600857544200-b2f666a9a2ec",
    eyebrow: "Clean beauty",
    heading: "Skincare that keeps it simple",
    sub: "Small-batch formulas with botanical ingredients you can pronounce — gentle enough for every day.",
    announcement: "Free samples with every order over ₹1,499",
    story: { eyebrow: "Made by hand", heading: "Small batches, honest ingredients", body: "[Replace with your story] We make every product in small batches so it reaches you fresh, and we list every ingredient in full.", bullets: ["Cruelty-free", "No parabens or synthetic fragrance", "Recyclable packaging"] },
    promises: SHIPPING_PROMISES({ icon: "leaf", title: "Gentle formulas", body: "Patch-tested and made for sensitive skin." }),
    collections: [
      { title: "Skincare", description: "Oils, serums and treatments.", photo: "1612817288484-6f916006741a" },
      { title: "Bath & body", description: "Handmade soaps and body care.", photo: "1600857544200-b2f666a9a2ec" },
      { title: "Makeup", description: "Brushes and everyday colour.", photo: "1596462502278-27bfdc403348" },
    ],
    products: [
      { title: "Botanical face oil ritual", description: "A face oil, toner and balm trio for a calm, glowing routine.", inr: 2499, compareInr: 2999, photo: "1612817288484-6f916006741a", collection: 0, featured: true, weightGrams: 400 },
      { title: "Handmade lavender soap trio", description: "Three cold-process bars with lavender, oat and shea butter.", inr: 649, photo: "1600857544200-b2f666a9a2ec", collection: 1, featured: true, options: { name: "Scent", values: ["Lavender", "Oat & honey", "Unscented"] }, weightGrams: 350 },
      { title: "Everyday makeup brush set", description: "Five soft vegan brushes for powder, blush, contour and eyes.", inr: 1799, photo: "1596462502278-27bfdc403348", collection: 2, featured: true, weightGrams: 250 },
    ],
    faq: [...COMMON_FAQ, { question: "Are your products suitable for sensitive skin?", answer: "[Edit for your products] Our formulas are gentle, but always patch-test a new product first." }],
  },
  {
    id: "home",
    name: "Home & living",
    category: "Home",
    description: "Calm, minimal styling for furniture, decor and ceramics.",
    storeName: "Nest & Norm",
    personality: "minimal",
    palette: "clay",
    accent: "#7d5a44",
    image: "1555041469-a586c61ea9bc",
    storyImage: "1493106641515-6b5631de4bb9",
    eyebrow: "Home & living",
    heading: "Quiet design for lived-in homes",
    sub: "Furniture, art and ceramics chosen to work together — and to last longer than a season.",
    announcement: "White-glove delivery on furniture in select cities",
    story: { eyebrow: "Made with makers", heading: "From their workshop to your home", body: "[Replace with your story] We work directly with small workshops and potters, so every piece has a story and a fair price.", bullets: ["Solid wood and natural materials", "Handmade ceramics", "Assembled and delivered with care"] },
    promises: SHIPPING_PROMISES({ icon: "house", title: "Styling advice", body: "Send us a photo of your room and we will help you choose." }),
    collections: [
      { title: "Furniture", description: "Sofas and statement chairs.", photo: "1567538096630-e0c55bd6374c" },
      { title: "Wall art", description: "Prints and framed pieces.", photo: "1513519245088-0e12902e5a38" },
      { title: "Ceramics", description: "Handmade tableware.", photo: "1610701596007-11502861dcfa" },
    ],
    products: [
      { title: "Emerald velvet three-seater sofa", description: "Deep seats, solid wood legs and soft velvet upholstery. Delivered assembled.", inr: 54999, compareInr: 64999, photo: "1555041469-a586c61ea9bc", collection: 0, featured: true, stock: 3, weightGrams: 45000 },
      { title: "Tufted cream accent chair", description: "A classic button-tufted armchair with turned legs.", inr: 18999, photo: "1567538096630-e0c55bd6374c", collection: 0, featured: true, stock: 4, weightGrams: 15000 },
      { title: "Curated gallery wall set", description: "Eight framed prints in mixed sizes with a hanging template.", inr: 7999, photo: "1513519245088-0e12902e5a38", collection: 1, featured: true, weightGrams: 6000 },
      { title: "Speckled stoneware cup set", description: "Four handmade cups in a speckled glaze with a raw clay base.", inr: 2199, photo: "1610701596007-11502861dcfa", collection: 2, featured: true, options: { name: "Glaze", values: ["Oat", "Sand"] }, weightGrams: 1200 },
    ],
    faq: [...COMMON_FAQ, { question: "Do you deliver furniture to my city?", answer: "[Edit to match your shipping] Furniture is delivered by our partners in select cities; enter your PIN code at checkout to see options." }],
  },
  {
    id: "bakery",
    name: "Bakery & café",
    category: "Food",
    description: "Warm, friendly styling for bakes, coffee and local delivery or pickup.",
    storeName: "Crumb & Co.",
    personality: "friendly",
    palette: "terracotta",
    accent: "#b44a27",
    image: "1509440159596-0249088772ff",
    storyImage: "1555507036-ab1f4038808a",
    eyebrow: "Baked fresh daily",
    heading: "Real bread, baked this morning",
    sub: "Slow-fermented sourdough, flaky pastries and freshly roasted coffee — delivered locally or ready for pickup.",
    announcement: "Order by 8 pm for next-morning delivery",
    story: { eyebrow: "Our ovens", heading: "Slow dough, early mornings", body: "[Replace with your story] Our sourdough ferments for 36 hours and everything is baked before sunrise, in small batches, with flour from local mills.", bullets: ["No preservatives", "Long, natural fermentation", "Freshly roasted coffee"] },
    promises: [
      { icon: "clock", title: "Next-morning delivery", body: "Order by 8 pm and we deliver fresh the next morning." },
      { icon: "house", title: "Free pickup", body: "Skip delivery and collect from our bakery." },
      { icon: "lock", title: "Pay your way", body: "UPI, cards or cash on delivery." },
    ],
    collections: [
      { title: "Breads", description: "Sourdough and loaves.", photo: "1509440159596-0249088772ff" },
      { title: "Pastries & treats", description: "Croissants, cupcakes and more.", photo: "1486427944299-d1955d23e34d" },
      { title: "Coffee", description: "Freshly roasted beans.", photo: "1587734195503-904fca47e0e9" },
    ],
    products: [
      { title: "Country sourdough loaf", description: "Our signature 36-hour sourdough with a crackling crust and open crumb.", inr: 249, photo: "1509440159596-0249088772ff", collection: 0, featured: true, stock: 40, weightGrams: 800 },
      { title: "Butter croissant box", description: "Six all-butter croissants, laminated by hand.", inr: 449, photo: "1555507036-ab1f4038808a", collection: 1, featured: true, options: { name: "Box", values: ["Box of 6", "Box of 12"] }, stock: 30, weightGrams: 500 },
      { title: "Mint frosting cupcakes", description: "Vanilla sponge with mint buttercream and sprinkles. Box of six.", inr: 399, photo: "1486427944299-d1955d23e34d", collection: 1, featured: true, stock: 24, weightGrams: 600 },
      { title: "House espresso beans", description: "Chocolatey, low-acid medium roast. Whole bean or ground.", inr: 599, photo: "1587734195503-904fca47e0e9", collection: 2, featured: true, options: { name: "Grind", values: ["Whole bean", "Espresso", "Filter"] }, stock: 50, weightGrams: 250 },
    ],
    faq: [{ question: "When will my order arrive?", answer: "[Edit to match your delivery] Orders placed before 8 pm are delivered the next morning between 7 and 11 am." }, { question: "Can I pick up instead?", answer: "Yes — choose Store pickup at checkout and collect from the bakery." }, COMMON_FAQ[2]],
  },
  {
    id: "books",
    name: "Bookshop",
    category: "Books",
    description: "Editorial, literary styling for books, bundles and reading subscriptions.",
    storeName: "Margin Books",
    personality: "editorial",
    palette: "navy",
    accent: "#1c2b52",
    image: "1507842217343-583bb7270b66",
    storyImage: "1495446815901-a7297e633e8d",
    eyebrow: "Independent bookshop",
    heading: "Books chosen by people who read them",
    sub: "Hand-picked fiction, non-fiction and curated bundles — wrapped with care and delivered to your door.",
    announcement: "Free gift wrapping on every order",
    story: { eyebrow: "Our shelves", heading: "Curated, not algorithmic", body: "[Replace with your story] Every title on our shelves has been read and recommended by someone on our team.", bullets: ["Staff picks every month", "Gift wrapping included", "Pre-orders on new releases"] },
    promises: SHIPPING_PROMISES({ icon: "education", title: "Staff picks", body: "Personal recommendations from our booksellers." }),
    collections: [
      { title: "Bundles", description: "Curated sets on a theme.", photo: "1512820790803-83ca734da794" },
      { title: "Classics", description: "Timeless hardcovers.", photo: "1495446815901-a7297e633e8d" },
    ],
    products: [
      { title: "Founder's reading bundle", description: "Five essential books on starting and growing a company, chosen by our team.", inr: 2999, compareInr: 3599, photo: "1512820790803-83ca734da794", collection: 0, featured: true, weightGrams: 2500 },
      { title: "Hardcover classics set", description: "Six cloth-bound classics with ribbon markers — a library in a box.", inr: 4499, photo: "1495446815901-a7297e633e8d", collection: 1, featured: true, weightGrams: 3500 },
      { title: "Monthly surprise book box", description: "One hand-picked book a month in your favourite genre, gift-wrapped.", inr: 699, photo: "1507842217343-583bb7270b66", collection: 0, featured: true, options: { name: "Genre", values: ["Fiction", "Non-fiction", "Mystery"] }, weightGrams: 600 },
    ],
    faq: [...COMMON_FAQ, { question: "Can you source a book you don't list?", answer: "[Edit to match your service] Yes — send us the title and we will let you know price and availability." }],
  },
  {
    id: "gadgets",
    name: "Tech & everyday carry",
    category: "Electronics",
    description: "Dark, modern styling for gadgets, audio and everyday carry.",
    storeName: "Volt Supply",
    personality: "dark-tech",
    palette: "aurora",
    accent: "#7c9cff",
    image: "1593642632823-8f785ba67e45",
    storyImage: "1583394838336-acd977736f90",
    eyebrow: "Gear that works",
    heading: "Tools for focused work",
    sub: "Audio, laptops and everyday carry — tested by our team before they reach our shelves.",
    announcement: "1-year warranty on all electronics",
    story: { eyebrow: "Tested in-house", heading: "We use it before we sell it", body: "[Replace with your story] Every product is put through a month of real daily use by our team before we list it.", bullets: ["1-year warranty", "Genuine products only", "Support from real people"] },
    promises: SHIPPING_PROMISES({ icon: "shield", title: "Warranty included", body: "Every gadget is covered for a full year." }),
    collections: [
      { title: "Audio", description: "Headphones and listening.", photo: "1583394838336-acd977736f90" },
      { title: "Computing", description: "Laptops and workstations.", photo: "1593642632823-8f785ba67e45" },
      { title: "Everyday carry", description: "Bags and bottles.", photo: "1622560480605-d83c853bc5c3" },
    ],
    products: [
      { title: "Over-ear wireless headphones", description: "Active noise cancelling, 40-hour battery and a fold-flat design.", inr: 7999, compareInr: 9999, photo: "1583394838336-acd977736f90", collection: 0, featured: true, options: { name: "Colour", values: ["Graphite", "Silver"] }, stock: 15, weightGrams: 450 },
      { title: "14-inch creator laptop", description: "Bright 14-inch display, 16 GB memory and an all-day battery.", inr: 74999, photo: "1593642632823-8f785ba67e45", collection: 1, featured: true, options: { name: "Storage", values: ["512 GB", "1 TB"] }, stock: 5, weightGrams: 2200 },
      { title: "Commuter laptop backpack", description: "Padded 15-inch sleeve, water-resistant base and quick-access pocket.", inr: 3499, photo: "1622560480605-d83c853bc5c3", collection: 2, featured: true, stock: 20, weightGrams: 1100 },
      { title: "Insulated steel bottle", description: "Keeps drinks cold for 24 hours or hot for 12. 750 ml.", inr: 1299, photo: "1602143407151-7111542de6e8", collection: 2, featured: true, options: { name: "Colour", values: ["Sage", "Black"] }, stock: 40, weightGrams: 400 },
    ],
    faq: [...COMMON_FAQ, { question: "How do warranty claims work?", answer: "[Edit to match your policy] Email us your order number and a short description; we arrange pickup and repair or replacement." }],
  },
  {
    id: "fitness",
    name: "Fitness & wellness",
    category: "Sports",
    description: "Bold, high-energy styling for training gear and yoga.",
    storeName: "Forge Athletics",
    personality: "bold",
    palette: "lime",
    accent: "#1d2b00",
    image: "1599058917212-d750089bc07e",
    storyImage: "1544367567-0f2fcb009e0b",
    eyebrow: "Train anywhere",
    heading: "Gear for the work you put in",
    sub: "Strength, conditioning and yoga essentials built for home gyms and daily training.",
    announcement: "Free shipping on orders over ₹1,999",
    story: { eyebrow: "Built to train", heading: "Equipment that keeps up", body: "[Replace with your story] We started in a garage gym and only sell gear we would trust under a heavy set.", bullets: ["Commercial-grade materials", "Tested by coaches", "30-day training guarantee"] },
    promises: SHIPPING_PROMISES({ icon: "dumbbell", title: "Coach-approved", body: "Every product is tested by certified trainers." }),
    collections: [
      { title: "Strength", description: "Weights and resistance.", photo: "1584735935682-2f2b69dff9d2" },
      { title: "Conditioning", description: "Ropes and cardio tools.", photo: "1599058917212-d750089bc07e" },
      { title: "Yoga", description: "Mats and recovery.", photo: "1601925260368-ae2f83cf8b7f" },
    ],
    products: [
      { title: "Home strength kit", description: "A pair of hex dumbbells with a long resistance band — a full-body workout in one box.", inr: 3299, compareInr: 3999, photo: "1584735935682-2f2b69dff9d2", collection: 0, featured: true, options: { name: "Weight", values: ["2 × 5 kg", "2 × 7.5 kg", "2 × 10 kg"] }, stock: 20, weightGrams: 12000 },
      { title: "Battle rope, 12 m", description: "38 mm heavy-duty poly rope with anchor strap for conditioning circuits.", inr: 4499, photo: "1599058917212-d750089bc07e", collection: 1, featured: true, stock: 8, weightGrams: 9000 },
      { title: "Grip yoga mat, 6 mm", description: "Non-slip natural rubber with alignment lines. Includes carry strap.", inr: 1999, photo: "1601925260368-ae2f83cf8b7f", collection: 2, featured: true, options: { name: "Colour", values: ["Forest", "Teal", "Plum"] }, stock: 30, weightGrams: 2500 },
      { title: "Steel training bottle", description: "Double-wall insulated, leak-proof, 750 ml.", inr: 1199, photo: "1602143407151-7111542de6e8", collection: 1, featured: true, stock: 50, weightGrams: 400 },
    ],
    faq: [...COMMON_FAQ, { question: "Which dumbbell weight should I choose?", answer: "[Edit with your guidance] Beginners usually start with 5 kg; message us and we will recommend a set for your goals." }],
  },
  {
    id: "gifts",
    name: "Gifts & hampers",
    category: "Gifting",
    description: "Playful, colourful styling for gift boxes, hampers and artisan goods.",
    storeName: "Little Joys",
    personality: "playful",
    palette: "coral",
    accent: "#d93f2b",
    image: "1549465220-1a8b9238cd48",
    storyImage: "1558642452-9d2a7deb7f62",
    eyebrow: "Thoughtful gifting",
    heading: "Gifts that feel personal",
    sub: "Handmade treats and artisan goods, beautifully wrapped with a handwritten note — delivered across India.",
    announcement: "Add a free handwritten note at checkout",
    story: { eyebrow: "Wrapped by hand", heading: "Every box packed with care", body: "[Replace with your story] We work with small producers and pack every hamper by hand, with a note written just for them.", bullets: ["Artisan producers", "Handwritten notes", "Plastic-free wrapping"] },
    promises: SHIPPING_PROMISES({ icon: "heart", title: "Personal notes", body: "Tell us what to write and we will handwrite it." }),
    collections: [
      { title: "Hampers", description: "Ready-to-gift boxes.", photo: "1549465220-1a8b9238cd48" },
      { title: "Artisan treats", description: "Honey, soaps and more.", photo: "1558642452-9d2a7deb7f62" },
    ],
    products: [
      { title: "Celebration gift box", description: "A curated box of treats and keepsakes, wrapped with a satin ribbon.", inr: 1999, compareInr: 2499, photo: "1549465220-1a8b9238cd48", collection: 0, featured: true, options: { name: "Size", values: ["Classic", "Grand"] }, weightGrams: 1500 },
      { title: "Raw forest honey", description: "Unprocessed wildflower honey from small apiaries. 350 g jar.", inr: 549, photo: "1558642452-9d2a7deb7f62", collection: 1, featured: true, weightGrams: 500 },
      { title: "Handmade soap gift trio", description: "Three cold-process soaps tied with twine — a lovely add-on.", inr: 599, photo: "1600857544200-b2f666a9a2ec", collection: 1, featured: true, weightGrams: 350 },
      { title: "Stoneware cup gift set", description: "Two handmade cups in a gift box — perfect for chai lovers.", inr: 1299, photo: "1610701596007-11502861dcfa", collection: 0, featured: true, weightGrams: 900 },
    ],
    faq: [...COMMON_FAQ, { question: "Can I send a gift to someone else?", answer: "Yes — enter their address at checkout and add your message in the order note." }],
  },

  // ── Modern templates: each has a signature look (see StoreLook). ──
  {
    id: "noir",
    name: "Noir streetwear",
    category: "Streetwear",
    description: "After-dark drops: full-bleed hero, a giant ticker and a cinematic lookbook.",
    storeName: "NOIR/DEPT",
    personality: "dark-tech",
    palette: "neon",
    accent: "#c6ff3d",
    image: "1523398002811-999ca8dec234",
    storyImage: "1556821840-3a63f95609a7",
    eyebrow: "Drop 07 · Limited run",
    heading: "Made for the night shift.",
    sub: "Heavyweight hoodies, boxy tees and everyday sneakers — dropped in small runs, never restocked the same way twice.",
    announcement: "Drop 07 is live · Free shipping over ₹1,999",
    story: { eyebrow: "The dept", heading: "Small runs. Loud ideas.", body: "[Replace with your story] We design in the city, print locally and make just enough. When a drop sells out, it's gone.", bullets: ["420 GSM brushed fleece", "Printed locally", "Numbered small runs"] },
    promises: SHIPPING_PROMISES({ icon: "zap", title: "Drop alerts", body: "Join the list and hear about new drops first." }),
    collections: [
      { title: "Hoodies", description: "Heavyweight, oversized, built to last.", photo: "1556821840-3a63f95609a7" },
      { title: "Tees", description: "Boxy fits and bold prints.", photo: "1576566588028-4147f3842f27" },
      { title: "Footwear", description: "Everyday sneakers.", photo: "1491553895911-0055eca6402d" },
    ],
    products: [
      { title: "Night-shift heavyweight hoodie", description: "420 GSM brushed fleece, dropped shoulders and a double-layer hood.", inr: 3499, compareInr: 3999, photo: "1556821840-3a63f95609a7", collection: 0, options: SIZES, featured: true, stock: 18, weightGrams: 900 },
      { title: "Street-print boxy tee", description: "Heavyweight cotton with a cracked screen print. Boxy, cropped fit.", inr: 1499, photo: "1576566588028-4147f3842f27", collection: 1, options: SIZES, featured: true, weightGrams: 260 },
      { title: "Cloud runner sneaker", description: "Lightweight knit upper with a cushioned sole for all-day wear.", inr: 5999, photo: "1491553895911-0055eca6402d", collection: 2, options: { name: "Size", values: ["UK 7", "UK 8", "UK 9", "UK 10"] }, featured: true, stock: 12, weightGrams: 800 },
      { title: "Shell windbreaker", description: "Water-resistant shell with a packable hood and taped seams.", inr: 4299, photo: "1591047139829-d91aecb6caea", collection: 0, options: SIZES, featured: true, weightGrams: 600 },
      { title: "Raw denim stack", description: "Rigid selvedge-look denim that fades to your shape.", inr: 3899, photo: "1604176354204-9268737828e4", collection: 1, options: { name: "Waist", values: ["30", "32", "34", "36"] }, weightGrams: 900 },
      { title: "Essential crew tee", description: "A soft everyday tee to layer under everything.", inr: 999, photo: "1523381210434-271e8be1f52b", collection: 1, options: SIZES, weightGrams: 220 },
    ],
    faq: [...COMMON_FAQ, { question: "Will a sold-out drop come back?", answer: "[Edit to match your plans] Most drops are one-time runs. Join the list to hear about the next one first." }],
    look: {
      fontPair: "avant",
      ui: { header: "transparent", buttonUppercase: true, headingWeight: 800, headingSpacing: -0.04 },
      hero: "overlay",
      ticker: { items: ["Drop 07", "Limited run", "Heavyweight fleece", "Ships in 48h", "No restocks"], variant: "outline" },
      lookbook: { heading: "Seen on the street", photos: [{ id: "1523398002811-999ca8dec234", alt: "Jacket on a city street" }, { id: "1556821840-3a63f95609a7", alt: "Grey hoodie from behind" }, { id: "1604176354204-9268737828e4", alt: "Stacked denim" }, { id: "1515886657613-9f3515b0c78f", alt: "Bold colour fit" }, { id: "1491553895911-0055eca6402d", alt: "Sneaker mid-air" }] },
      darkStory: false,
    },
  },
  {
    id: "kiln",
    name: "Kiln ceramics studio",
    category: "Handmade",
    description: "Gallery-quiet editorial design for handmade objects, with a slow-scrolling lookbook.",
    storeName: "Kiln & Co.",
    personality: "editorial",
    palette: "clay",
    accent: "#7d5a44",
    image: "1493106641515-6b5631de4bb9",
    storyImage: "1565193566173-7a0ee3dbe261",
    eyebrow: "Thrown by hand",
    heading: "Objects with a maker's fingerprint.",
    sub: "Small-batch stoneware — cups, bowls and vases thrown, glazed and fired in our studio.",
    announcement: "New kiln batch every Friday · Wrapped with care",
    story: { eyebrow: "The studio", heading: "Slow-made, on purpose", body: "[Replace with your story] Every piece is thrown on the wheel, trimmed by hand and fired twice. No two are quite alike — that's the point.", bullets: ["Food-safe, lead-free glazes", "Dishwasher-friendly stoneware", "Fired twice for strength"] },
    promises: SHIPPING_PROMISES({ icon: "heart", title: "Packed to survive", body: "Double-boxed with paper padding — and replaced if anything breaks." }),
    collections: [
      { title: "Cups & mugs", description: "For chai, coffee and slow mornings.", photo: "1610701596007-11502861dcfa" },
      { title: "Tableware", description: "Plates and bowls for every day.", photo: "1610701596061-2ecf227e85b2" },
      { title: "Vases", description: "Sculptural pieces for a single stem.", photo: "1490312278390-ab64016e0aa9" },
    ],
    products: [
      { title: "Speckled stoneware cup set", description: "Four cups in an oat glaze with a raw clay foot.", inr: 2199, photo: "1610701596007-11502861dcfa", collection: 0, featured: true, stock: 10, weightGrams: 1200 },
      { title: "Everyday dinner set", description: "Plates and bowls in a soft cream glaze, made to stack.", inr: 5499, photo: "1610701596061-2ecf227e85b2", collection: 1, featured: true, stock: 6, weightGrams: 4000 },
      { title: "Twin bud vases", description: "A pair of slender white vases for single stems.", inr: 1899, photo: "1490312278390-ab64016e0aa9", collection: 2, featured: true, stock: 8, weightGrams: 700 },
      { title: "Charcoal bottle vases", description: "Three matte stoneware bottles in graded heights.", inr: 3299, photo: "1565193566173-7a0ee3dbe261", collection: 2, featured: true, stock: 5, weightGrams: 1500 },
      { title: "Reactive-glaze plate stack", description: "Blue reactive glaze that pools differently on every plate.", inr: 2899, photo: "1578749556568-bc2c40e68b61", collection: 1, stock: 7, weightGrams: 2400 },
    ],
    faq: [...COMMON_FAQ, { question: "Is every piece exactly like the photo?", answer: "Each piece is handmade, so glaze and shape vary a little. That variation is part of what makes it yours." }],
    look: {
      fontPair: "gallery",
      ui: { header: "sticky", headingWeight: 400, headingSpacing: -0.03, sectionSpace: 1.2 },
      hero: "editorial",
      ticker: { items: ["Thrown by hand", "Fired twice", "Food-safe glazes", "Small batches"], variant: "subtle" },
      lookbook: { heading: "From the wheel", photos: [{ id: "1493106641515-6b5631de4bb9", alt: "Hands shaping clay on a wheel" }, { id: "1565193566173-7a0ee3dbe261", alt: "Dark stoneware bottles" }, { id: "1610701596061-2ecf227e85b2", alt: "Tableware on a wooden shelf" }, { id: "1578749556568-bc2c40e68b61", alt: "Stacked blue plates" }, { id: "1490312278390-ab64016e0aa9", alt: "White bud vases" }] },
      darkStory: true,
    },
  },
  {
    id: "verde",
    name: "Verde plant shop",
    category: "Plants",
    description: "Fresh, airy and green: a moody full-bleed hero, bento promises and a leafy lookbook.",
    storeName: "Verde Botanics",
    personality: "organic",
    palette: "matcha",
    accent: "#4f6b26",
    image: "1520412099551-62b6bafeb5bb",
    storyImage: "1512428813834-c702c7702b78",
    eyebrow: "Plants, delivered potted",
    heading: "Bring the outside in.",
    sub: "Easy-care plants in handmade pots, delivered to your door with a care card that actually makes sense.",
    announcement: "Same-week delivery in the city · Free care chat for 30 days",
    story: { eyebrow: "Grown with care", heading: "Healthy plants, happy homes", body: "[Replace with your story] We grow and acclimatise every plant in our nursery before it leaves, so it settles into your home without the sulk.", bullets: ["Nursery-grown and acclimatised", "Pots with drainage holes", "Plain-English care cards"] },
    promises: SHIPPING_PROMISES({ icon: "leaf", title: "30-day plant promise", body: "If it struggles in the first month, we'll help — or replace it." }),
    collections: [
      { title: "Easy-care", description: "Almost unkillable picks.", photo: "1485955900006-10f4d324d411" },
      { title: "Cacti & succulents", description: "Sun-lovers that sip water.", photo: "1459411552884-841db9b3cc2a" },
      { title: "Statement plants", description: "Big leaves, bigger personality.", photo: "1501004318641-b39e6451bec6" },
    ],
    products: [
      { title: "Zebra haworthia in mint pot", description: "A striped little succulent in a glossy mint ceramic pot.", inr: 649, photo: "1485955900006-10f4d324d411", collection: 0, featured: true, stock: 20, weightGrams: 600 },
      { title: "Bunny-ear cactus", description: "A cheerful cactus in a terracotta pot. Loves a sunny sill.", inr: 549, photo: "1459411552884-841db9b3cc2a", collection: 1, featured: true, stock: 24, weightGrams: 700 },
      { title: "Ficus bonsai", description: "A small ginseng ficus with sculptural roots. Bright, indirect light.", inr: 1899, photo: "1512428813834-c702c7702b78", collection: 2, featured: true, stock: 8, weightGrams: 1500 },
      { title: "Rubber plant starter", description: "Glossy leaves that grow into a statement piece.", inr: 899, photo: "1501004318641-b39e6451bec6", collection: 0, featured: true, stock: 15, weightGrams: 1200 },
      { title: "Desert cactus trio", description: "Three cacti that need water once a fortnight.", inr: 1299, photo: "1463936575829-25148e1db1b8", collection: 1, stock: 12, weightGrams: 1800 },
    ],
    faq: [...COMMON_FAQ, { question: "How do plants travel?", answer: "Potted, wrapped and boxed upright so the soil stays put. Unbox it on arrival and give it a day to settle." }],
    look: {
      fontPair: "expressive",
      ui: { header: "sticky", buttonSize: "lg" },
      hero: "overlay",
      ticker: { items: ["Nursery-grown", "Delivered potted", "30-day promise", "Care chat included"], variant: "bold" },
      lookbook: { heading: "Little jungles", photos: [{ id: "1520412099551-62b6bafeb5bb", alt: "Topiary tree against a dark wall" }, { id: "1463936575829-25148e1db1b8", alt: "A row of cacti" }, { id: "1512428813834-c702c7702b78", alt: "A small bonsai" }, { id: "1459411552884-841db9b3cc2a", alt: "Cactus in a terracotta pot" }, { id: "1501004318641-b39e6451bec6", alt: "Young rubber plant" }] },
      darkStory: true,
    },
  },
  {
    id: "sonic",
    name: "Sonic audio & tech",
    category: "Electronics",
    description: "Product-launch energy: glowing dark theme, centred hero and spec-sheet styling.",
    storeName: "SONIC",
    personality: "glass",
    palette: "aurora",
    accent: "#7c9cff",
    image: "1546435770-a3e426bf472b",
    storyImage: "1484704849700-f032a568e944",
    eyebrow: "New · Studio series",
    heading: "Hear every detail.",
    sub: "Headphones and wearables tuned for long listening — with honest specs and a 1-year warranty.",
    announcement: "1-year warranty on everything · Free returns within 7 days",
    story: { eyebrow: "Tuned, not hyped", heading: "Specs you can trust", body: "[Replace with your story] We test every model for comfort and battery life over real days of use, and publish the numbers as we measured them.", bullets: ["1-year warranty", "Replaceable ear cushions", "Type-C everything"] },
    promises: SHIPPING_PROMISES({ icon: "shield", title: "1-year warranty", body: "Hassle-free repairs or replacement through us." }),
    collections: [
      { title: "Headphones", description: "Over-ear and on-ear.", photo: "1546435770-a3e426bf472b" },
      { title: "Wearables", description: "Watches and everyday tech.", photo: "1617043786394-f977fa12eddf" },
      { title: "Classics", description: "Timeless designs.", photo: "1484704849700-f032a568e944" },
    ],
    products: [
      { title: "Studio ANC headphones", description: "Active noise cancelling, 40-hour battery and memory-foam cushions.", inr: 8999, compareInr: 10999, photo: "1546435770-a3e426bf472b", collection: 0, options: { name: "Colour", values: ["Graphite", "Bone"] }, featured: true, stock: 15, weightGrams: 450 },
      { title: "Heritage on-ear headphones", description: "Brushed aluminium cups and a woven cable for a warm, classic sound.", inr: 5499, photo: "1484704849700-f032a568e944", collection: 2, featured: true, stock: 10, weightGrams: 300 },
      { title: "Everyday smartwatch", description: "Heart-rate, steps and notifications with a 7-day battery.", inr: 6999, photo: "1617043786394-f977fa12eddf", collection: 1, featured: true, stock: 12, weightGrams: 150 },
      { title: "Sunshine wireless headphones", description: "Lightweight wireless headphones in a bright, happy colour.", inr: 3999, photo: "1505740420928-5e560c06d30e", collection: 0, featured: true, stock: 20, weightGrams: 250 },
      { title: "Minimal analogue watch", description: "A clean white dial and a soft strap. Water-resistant.", inr: 4499, photo: "1523275335684-37898b6baf30", collection: 2, stock: 9, weightGrams: 120 },
    ],
    faq: [...COMMON_FAQ, { question: "How does the warranty work?", answer: "[Edit to match your policy] Message us with your order number. We'll repair or replace within the warranty period." }],
    look: {
      fontPair: "tech",
      ui: { header: "glass", headingWeight: 600, headingSpacing: -0.05 },
      hero: "centered",
      heroDecor: "glow",
      ticker: { items: ["40h battery", "Active noise cancelling", "1-year warranty", "Type-C"], variant: "outline" },
      lookbook: { heading: "Made to be worn", photos: [{ id: "1546435770-a3e426bf472b", alt: "Black headphones on a white desk" }, { id: "1484704849700-f032a568e944", alt: "Silver and tan headphones" }, { id: "1617043786394-f977fa12eddf", alt: "Smartwatch beside its box" }, { id: "1505740420928-5e560c06d30e", alt: "Headphones on yellow" }, { id: "1523275335684-37898b6baf30", alt: "White watches" }] },
      darkStory: false,
    },
  },
  {
    id: "casa",
    name: "Casa modern living",
    category: "Furniture",
    description: "Warm, architectural and calm: big serif type, room-by-room shopping and a lived-in lookbook.",
    storeName: "Casa Forma",
    personality: "luxury",
    palette: "champagne",
    accent: "#7e5f33",
    image: "1586023492125-27b2c045efd7",
    storyImage: "1555041469-a586c61ea9bc",
    eyebrow: "Modern living",
    heading: "Rooms that feel like you.",
    sub: "Sofas, chairs and objects in honest materials — designed to live with, not just look at.",
    announcement: "White-glove delivery in metro cities · Free design consultation",
    story: { eyebrow: "Built to last", heading: "Honest materials, made well", body: "[Replace with your story] Solid wood frames, removable covers and fabrics that age gracefully. We'd rather you keep it for years than replace it in two.", bullets: ["Solid wood frames", "Removable, washable covers", "5-year frame warranty"] },
    promises: SHIPPING_PROMISES({ icon: "house", title: "White-glove delivery", body: "Carried in, assembled and packaging taken away." }),
    collections: [
      { title: "Sofas", description: "Deep seats for long evenings.", photo: "1555041469-a586c61ea9bc" },
      { title: "Chairs", description: "Accent and lounge chairs.", photo: "1586023492125-27b2c045efd7" },
      { title: "Living spaces", description: "Complete the room.", photo: "1618221195710-dd6b41faaea6" },
    ],
    products: [
      { title: "Velvet three-seater sofa", description: "Deep-green velvet, solid wood legs and feather-blend cushions.", inr: 64999, compareInr: 72999, photo: "1555041469-a586c61ea9bc", collection: 0, options: { name: "Colour", values: ["Forest", "Ochre", "Stone"] }, featured: true, stock: 4, weightGrams: 60000 },
      { title: "Sunday lounge chair", description: "A mustard accent chair with a gentle recline.", inr: 18999, photo: "1586023492125-27b2c045efd7", collection: 1, featured: true, stock: 6, weightGrams: 15000 },
      { title: "Linen living set", description: "A styled set of cushions and a throw in washed linen.", inr: 6999, photo: "1618221195710-dd6b41faaea6", collection: 2, featured: true, stock: 10, weightGrams: 3000 },
      { title: "Minimal coffee table", description: "A low oak table with rounded corners.", inr: 14999, photo: "1513694203232-719a280e022f", collection: 2, featured: true, stock: 5, weightGrams: 20000 },
    ],
    faq: [...COMMON_FAQ, { question: "Can I see the fabric first?", answer: "[Edit to match your offer] Yes — order free fabric swatches from any sofa page." }],
    look: {
      fontPair: "luxury",
      ui: { header: "sticky", headingWeight: 500, buttonUppercase: true, sectionSpace: 1.15 },
      hero: "overlay",
      ticker: { items: ["Solid wood frames", "White-glove delivery", "5-year warranty", "Free design consultation"], variant: "subtle" },
      lookbook: { heading: "At home with Casa", photos: [{ id: "1586023492125-27b2c045efd7", alt: "Mustard chair in a styled room" }, { id: "1618221195710-dd6b41faaea6", alt: "Warm living room" }, { id: "1555041469-a586c61ea9bc", alt: "Green velvet sofa" }, { id: "1513694203232-719a280e022f", alt: "Minimal living room" }, { id: "1600210492486-724fe5c67fb0", alt: "Sunlit living room with a gallery wall" }] },
      darkStory: true,
    },
  },

  // ── Glass collection: frosted panels over soft colour light, every category. ──
  glassTemplate({
    id: "lumen", name: "Lumen skincare", category: "Skincare & fragrance", storeName: "Lumen", palette: "porcelain", accent: "#0066d6", fontPair: "gallery", hero: "overlay",
    description: "Dewy glass panels over soft light — clinical-clean, calm and premium.",
    image: "1570172619644-dfd03ed5d881", storyImage: "1617897903246-719242758050",
    eyebrow: "Clean actives · Dermatologist-tested", heading: "Skin that glows from within.", sub: "Serums, creams and fragrances with short ingredient lists and honest results.",
    announcement: "Free samples with every order · Gentle on sensitive skin",
    story: { eyebrow: "Our formulas", heading: "Fewer ingredients. Better skin.", body: "[Replace with your story] Every formula is tested on sensitive skin and made in small batches, with every ingredient listed on the box.", bullets: ["Fragrance-free options", "Never tested on animals", "Recyclable glass bottles"] },
    extra: { icon: "sparkles", title: "Skin-type help", body: "Not sure what suits you? Ask us — we'll recommend a routine." },
    collections: [["Serums", "Targeted treatments.", "1608571423902-eed4a5ad8108"], ["Moisturisers", "Daily hydration.", "1601049541289-9b1b7bbbfe19"], ["Fragrance", "Soft, clean scents.", "1588405748880-12d1d2a59f75"]],
    products: [
      ["Vitamin C brightening serum", "15% vitamin C with ferulic acid for a brighter, even tone.", 1499, "1608571423902-eed4a5ad8108", 0, 1799],
      ["Barrier repair cream", "Ceramides and squalane for calm, comfortable skin.", 1299, "1601049541289-9b1b7bbbfe19", 1],
      ["Serum & jade roller set", "A hydrating serum with a cooling jade roller.", 1899, "1600428877878-1a0fd85beda8", 0],
      ["Amber eau de parfum", "Warm amber, vanilla and a hint of cedar. 50 ml.", 2999, "1588405748880-12d1d2a59f75", 2],
      ["Botanical face oil", "Cold-pressed oils for an overnight glow.", 1199, "1617897903246-719242758050", 0],
    ],
    ticker: ["Clean actives", "Dermatologist-tested", "Cruelty-free", "Free samples"],
    lookbook: ["Your ritual", [["1612817288484-6f916006741a", "Skincare flatlay with stones"], ["1617897903246-719242758050", "Serum on a wooden board"], ["1600428877878-1a0fd85beda8", "Serum bottle and jade roller"], ["1601049541289-9b1b7bbbfe19", "Cream jar held in a hand"], ["1608571423902-eed4a5ad8108", "Dropper bottle in soft light"]]],
    faq: ["Is it suitable for sensitive skin?", "[Edit for your products] Every formula is tested on sensitive skin. Patch-test first if you react easily."],
  }),
  glassTemplate({
    id: "tote", name: "Tote & Co. bags", category: "Bags & accessories", storeName: "Tote & Co.", palette: "rosewood", accent: "#9f3a4a", fontPair: "luxury", hero: "centered", heroDecor: "mesh",
    description: "Rosy glass and serif elegance for handbags, totes and leather goods.",
    image: "1590874103328-eac38a683ce7", storyImage: "1622560480605-d83c853bc5c3",
    eyebrow: "New colours for the season", heading: "Carry something beautiful.", sub: "Handbags, totes and backpacks in leather and woven straw — made to be used every day.",
    announcement: "Free monogramming this week · Easy 7-day returns",
    story: { eyebrow: "The workshop", heading: "Made to be carried for years", body: "[Replace with your story] Full-grain leather, solid brass hardware and stitching you can trust — finished by hand in small runs.", bullets: ["Full-grain leather", "Solid brass hardware", "1-year repair promise"] },
    extra: { icon: "gem", title: "Free monogram", body: "Add your initials at checkout — on the house." },
    collections: [["Handbags", "Structured and polished.", "1584917865442-de89df76afd3"], ["Totes & woven", "Light, roomy, sunny.", "1590874103328-eac38a683ce7"], ["Backpacks", "Everyday carry.", "1622560480605-d83c853bc5c3"]],
    products: [
      ["Ruby top-handle bag", "Structured leather with a polished turn-lock.", 6499, "1584917865442-de89df76afd3", 0, 7499],
      ["Sunset woven tote", "Hand-woven straw with leather handles.", 3299, "1590874103328-eac38a683ce7", 1],
      ["Blush evening clutch", "A slim leather clutch with a detachable chain.", 2899, "1566150905458-1bf1fc113f0d", 0],
      ["Everyday leather backpack", "Padded laptop sleeve and two outer pockets.", 4499, "1622560480605-d83c853bc5c3", 2],
      ["City commuter backpack", "Water-resistant fabric with a hidden back pocket.", 3499, "1553062407-98eeb64c6a62", 2],
    ],
    ticker: ["Full-grain leather", "Free monogram", "Hand-finished", "1-year repair promise"],
    lookbook: ["Out and about", [["1590874103328-eac38a683ce7", "Woven straw bag"], ["1584917865442-de89df76afd3", "Red leather handbag"], ["1566150905458-1bf1fc113f0d", "Blush clutch on a plinth"], ["1553062407-98eeb64c6a62", "Navy backpack in light and shadow"], ["1622560480605-d83c853bc5c3", "Leather backpack"]]],
    faq: ["How do I care for leather?", "Wipe with a soft dry cloth and condition every few months. Keep it out of direct sun when stored."],
  }),
  glassTemplate({
    id: "saanjh", name: "Saanjh ethnic wear", category: "Ethnic wear", storeName: "Saanjh", palette: "berry", accent: "#be185d", fontPair: "classic", hero: "overlay",
    description: "Festive glass over jewel tones for sarees, lehengas and occasion wear.",
    image: "1617627143750-d86bc21e42bb", storyImage: "1610030469983-98e550d6193c",
    eyebrow: "The festive edit", heading: "Draped in celebration.", sub: "Handloom sarees, lehengas and flowing dresses — woven by artisans, ready for every occasion.",
    announcement: "Festive dispatch in 48 hours · Free fall & pico on sarees",
    story: { eyebrow: "From the loom", heading: "Woven by hand, worn with pride", body: "[Replace with your story] We work directly with weaving families, so every piece carries their craft — and they're paid fairly for it.", bullets: ["Handloom and pure silk", "Free fall & pico", "Blouse stitching on request"] },
    extra: { icon: "heart", title: "Styling on WhatsApp", body: "Send us a photo of the occasion and we'll help you choose." },
    collections: [["Sarees", "Silk, cotton and handloom.", "1610030469983-98e550d6193c"], ["Lehengas & sets", "For weddings and festivals.", "1617627143750-d86bc21e42bb"], ["Dresses", "Flowing, easy, festive.", "1609357605129-26f69add5d6e"]],
    products: [
      ["Crimson silk saree", "Pure silk with a woven gold border. Unstitched blouse included.", 8999, "1610030469983-98e550d6193c", 0, 10999],
      ["Rani pink festive saree", "Lightweight silk blend in a bright rani pink.", 6499, "1617627143750-d86bc21e42bb", 1],
      ["Teal flowing maxi dress", "Tiered cotton maxi with a wrap neckline.", 3299, "1609357605129-26f69add5d6e", 2, null, true],
    ],
    ticker: ["Handloom", "Pure silk", "Free fall & pico", "Festive dispatch in 48h"],
    lookbook: ["The festive edit", [["1617627143750-d86bc21e42bb", "Rani pink saree with gold jewellery"], ["1610030469983-98e550d6193c", "Crimson silk saree"], ["1609357605129-26f69add5d6e", "Teal maxi dress in the fields"]]],
    faq: ["Do you stitch blouses?", "[Edit to match your service] Yes — share your measurements at checkout and we'll stitch it in 5–7 days."],
  }),
  glassTemplate({
    id: "brewhouse", name: "Brewhouse coffee & tea", category: "Coffee & tea", storeName: "Brewhouse", palette: "espresso", accent: "#d4a373", fontPair: "editorial", hero: "overlay",
    description: "Warm espresso glass for roasters and tea houses — cosy, rich and slow.",
    image: "1447933601403-0c6688de566e", storyImage: "1511920170033-f8396924c348",
    eyebrow: "Roasted this week", heading: "Your morning, upgraded.", sub: "Single-origin coffee and loose-leaf tea, roasted and packed fresh in small batches.",
    announcement: "Roasted to order · Free shipping over ₹999",
    story: { eyebrow: "The roastery", heading: "Small batches, roasted to order", body: "[Replace with your story] We roast twice a week and ship within days, so your coffee arrives at its best — never months old.", bullets: ["Roast date on every bag", "Traceable estates", "Whole bean or ground to order"] },
    extra: { icon: "coffee", title: "Brew guides", body: "Every bag comes with a simple brew guide for your method." },
    collections: [["Coffee", "Single-origin and blends.", "1587734195503-904fca47e0e9"], ["Tea", "Loose leaf and chai.", "1564890369478-c89ca6d9cde9"], ["Brewing gear", "For a better cup.", "1511920170033-f8396924c348"]],
    products: [
      ["House espresso blend, 250 g", "Chocolatey and low-acid. Whole bean or ground.", 599, "1587734195503-904fca47e0e9", 0, null, false, ["Grind", ["Whole bean", "Espresso", "Filter"]]],
      ["Estate single-origin, 250 g", "Bright and fruity from a single hill estate.", 749, "1447933601403-0c6688de566e", 0],
      ["Assam breakfast tea, 100 g", "Malty loose-leaf black tea, perfect with milk.", 449, "1564890369478-c89ca6d9cde9", 1],
      ["Masala chai blend, 100 g", "Black tea with cardamom, ginger and cinnamon.", 399, "1544787219-7f47ccb76574", 1],
      ["Barista portafilter set", "A stainless portafilter with a tamper and dosing cup.", 2499, "1511920170033-f8396924c348", 2],
    ],
    ticker: ["Roasted to order", "Single origin", "Loose-leaf tea", "Free brew guides"],
    lookbook: ["Slow mornings", [["1495474472287-4d71bcdd2085", "Cups of latte art"], ["1509042239860-f550ce710b93", "Latte with plants"], ["1564890369478-c89ca6d9cde9", "Teapot and cup"], ["1587734195503-904fca47e0e9", "Coffee beans in a bowl"], ["1544787219-7f47ccb76574", "Tea with biscuits"]]],
    faq: ["Whole bean or ground?", "Both — choose at checkout. Whole bean stays fresh longest; we grind to your brew method if you prefer."],
  }),
  glassTemplate({
    id: "harvest", name: "Harvest organic grocery", category: "Grocery & wellness", storeName: "Harvest", palette: "sage", accent: "#3e6b3a", fontPair: "friendly", hero: "overlay",
    description: "Fresh, leafy glass for farm-to-door groceries, pantry and wellness.",
    image: "1488459716781-31db52582fe9", storyImage: "1540420773420-3366772f4999",
    eyebrow: "Farm to door", heading: "Fresh food, the honest way.", sub: "Seasonal produce, cold-pressed oils and pantry staples from farms we know by name.",
    announcement: "Next-day delivery in the city · Order by 9 pm",
    story: { eyebrow: "Our farmers", heading: "Grown well, picked fresh", body: "[Replace with your story] We buy straight from small farms, pay them fairly and get produce to you within a day of harvest.", bullets: ["Seasonal and local", "No middlemen", "Plastic-free packing"] },
    extra: { icon: "leaf", title: "Freshness promise", body: "Not happy with something? We'll replace it next delivery." },
    collections: [["Fruit & veg", "Picked this week.", "1610832958506-aa56368176cf"], ["Pantry", "Oils, grains and more.", "1474979266404-7eaacbcd87c5"], ["Ready to eat", "Salads and bowls.", "1505576399279-565b52d4ac71"]],
    products: [
      ["Seasonal fruit box", "A mixed box of this week's best fruit — around 3 kg.", 699, "1610832958506-aa56368176cf", 0],
      ["Cold-pressed olive oil, 500 ml", "Extra-virgin, first cold-press, in dark glass.", 899, "1474979266404-7eaacbcd87c5", 1],
      ["Rainbow salad bowl", "Crisp greens, roasted veg and seeds with a tahini dressing.", 299, "1540420773420-3366772f4999", 2],
      ["Layered salad jar", "Meal-prep jar with grains, greens and beans.", 249, "1505576399279-565b52d4ac71", 2],
      ["Farmers' market veg box", "Mixed seasonal vegetables for a family of four.", 549, "1542838132-92c53300491e", 0],
    ],
    ticker: ["Farm to door", "Next-day delivery", "Plastic-free", "Seasonal"],
    lookbook: ["This week's harvest", [["1488459716781-31db52582fe9", "A market stall full of produce"], ["1610832958506-aa56368176cf", "Halved tropical fruits"], ["1540420773420-3366772f4999", "Colourful salad bowl"], ["1474979266404-7eaacbcd87c5", "Olive oil and olives"], ["1542838132-92c53300491e", "Fresh vegetables on shelves"]]],
    faq: ["When will my order arrive?", "[Edit for your area] Order by 9 pm for next-day delivery. You'll get a delivery window by SMS."],
  }),
  glassTemplate({
    id: "tinytales", name: "Tiny Tales kids & toys", category: "Kids & toys", storeName: "Tiny Tales", palette: "lavender", accent: "#6b4fa3", fontPair: "friendly", hero: "centered", heroDecor: "mesh",
    description: "Playful pastel glass for toys, games and little-one essentials.",
    image: "1596461404969-9ae70f2830c1", storyImage: "1503454537195-1dcabb73ffb9",
    eyebrow: "Play, made thoughtfully", heading: "Toys they'll love for years.", sub: "Wooden toys, cuddly friends and creative play — safe, sturdy and screen-free.",
    announcement: "Free gift wrap · Safe, non-toxic finishes",
    story: { eyebrow: "Why wooden", heading: "Built for imagination", body: "[Replace with your story] We pick toys that grow with your child — open-ended, beautifully made and safe to chew on.", bullets: ["Non-toxic paints", "Age-tested for safety", "Plastic-light packaging"] },
    extra: { icon: "smile", title: "Free gift wrap", body: "Add a note and we'll wrap it with a ribbon." },
    collections: [["Wooden toys", "Trains, blocks and more.", "1596461404969-9ae70f2830c1"], ["Soft toys", "Cuddly friends.", "1530325553241-4f6e7690cf36"], ["Play sets", "Creative, open-ended play.", "1515488042361-ee00e0ddd4e4"]],
    products: [
      ["Wooden town train set", "A 32-piece track with a train, trees and a station.", 2499, "1596461404969-9ae70f2830c1", 0, 2999],
      ["Honey bear soft toy", "Super-soft, machine-washable and safe from birth.", 899, "1530325553241-4f6e7690cf36", 1],
      ["Little explorer play set", "Animals, books and blocks for floor-time play.", 1799, "1515488042361-ee00e0ddd4e4", 2],
      ["Retro robot collection", "Four wind-up robots for collectors big and small.", 1499, "1558060370-d644479cb6f7", 2],
    ],
    ticker: ["Non-toxic", "Screen-free play", "Free gift wrap", "Age-tested"],
    lookbook: ["Playtime", [["1503454537195-1dcabb73ffb9", "A smiling child with face paint"], ["1596461404969-9ae70f2830c1", "Wooden train set"], ["1515488042361-ee00e0ddd4e4", "Toddler playing with toys"], ["1530325553241-4f6e7690cf36", "Teddy bear"], ["1558060370-d644479cb6f7", "Colourful vintage toys"]]],
    faq: ["What ages are your toys for?", "Each product lists its recommended age. Toys with small parts are marked 3+."],
  }),
  glassTemplate({
    id: "pawpal", name: "Pawpal pet supplies", category: "Pet supplies", storeName: "Pawpal", palette: "ocean", accent: "#0b6e99", fontPair: "expressive", hero: "overlay",
    description: "Bright, breezy glass for food, toys and comfy things for pets.",
    image: "1576201836106-db1758fd1c97", storyImage: "1450778869180-41d0601e046e",
    eyebrow: "For good boys and girls", heading: "Happy pets live here.", sub: "Healthy food, tough toys and cosy gear — vet-approved and tail-wag tested.",
    announcement: "Subscribe & save 10% on food · Free delivery over ₹799",
    story: { eyebrow: "Vet-approved", heading: "Only what we'd give our own", body: "[Replace with your story] Every food and treat is checked with our vet, and every toy is tested by our very serious team of dogs.", bullets: ["Grain-free options", "Durable, chew-safe toys", "Vet-checked recipes"] },
    extra: { icon: "heart", title: "Subscribe & save", body: "Get food on a schedule and save 10% on every delivery." },
    collections: [["Food & treats", "Healthy and tasty.", "1589924691995-400dc9ecc119"], ["Toys", "Tough and fun.", "1535294435445-d7249524ef2e"], ["Wear & comfort", "Jumpers and cosy things.", "1583337130417-3346a1be7dee"]],
    products: [
      ["Grain-free dry food, 3 kg", "Chicken and sweet potato with added omega oils.", 1899, "1589924691995-400dc9ecc119", 0, null, false, ["Size", ["3 kg", "7 kg"]]],
      ["Tough chew bone", "Natural rubber that stands up to big chewers.", 499, "1535294435445-d7249524ef2e", 1],
      ["Sunny knit jumper", "A soft knit jumper for chilly walks.", 999, "1583337130417-3346a1be7dee", 2, null, false, ["Size", ["S", "M", "L"]]],
      ["Beach day play pack", "A ball, a rope and a floating toy for water dogs.", 799, "1587300003388-59208cc962cb", 1],
    ],
    ticker: ["Vet-approved", "Tail-wag tested", "Subscribe & save", "Free delivery over ₹799"],
    lookbook: ["Best friends", [["1576201836106-db1758fd1c97", "Puppy running in golden light"], ["1450778869180-41d0601e046e", "Dog and cat resting"], ["1587300003388-59208cc962cb", "Happy dog on the beach"], ["1583337130417-3346a1be7dee", "Bulldog in a yellow jumper"], ["1548199973-03cce0bbc87b", "Two small dogs running"]]],
    faq: ["Can I change my food subscription?", "[Edit to match your settings] Yes — skip, pause or change your delivery any time from your account."],
  }),
  glassTemplate({
    id: "optica", name: "Optica eyewear & watches", category: "Eyewear & watches", storeName: "OPTICA", palette: "graphite", accent: "#5ac8fa", fontPair: "tech", hero: "centered", heroDecor: "glow",
    description: "Crisp graphite glass for frames, sunglasses and timepieces.",
    image: "1511499767150-a48a237f0083", storyImage: "1524592094714-0f0654e20314",
    eyebrow: "Precision, worn daily", heading: "See sharper. Look sharper.", sub: "Optical frames, polarised sunglasses and minimalist watches — designed in-house.",
    announcement: "Free home try-on · Prescription lenses included",
    story: { eyebrow: "Made to measure", heading: "Lenses fitted to you", body: "[Replace with your story] Send your prescription and we cut, fit and check your lenses before they ship — anti-glare included.", bullets: ["Prescription lenses included", "Anti-glare coating", "1-year warranty"] },
    extra: { icon: "shield", title: "Home try-on", body: "Pick three frames to try at home for 5 days, free." },
    collections: [["Optical", "Everyday frames.", "1574258495973-f010dfbb5371"], ["Sunglasses", "Polarised lenses.", "1511499767150-a48a237f0083"], ["Watches", "Minimal timepieces.", "1524592094714-0f0654e20314"]],
    products: [
      ["Round wire sunglasses", "Polarised green lenses in a light gold frame.", 3499, "1511499767150-a48a237f0083", 1],
      ["Classic browline frames", "Tortoiseshell browline with clear lenses.", 2999, "1574258495973-f010dfbb5371", 0],
      ["Minimal leather watch", "A clean white dial on a brown leather strap.", 4999, "1524592094714-0f0654e20314", 2, 5999],
      ["Everyday smartwatch", "Heart-rate, steps and a 7-day battery.", 6999, "1508685096489-7aacd43bd3b1", 2],
      ["White dial watch duo", "Two minimalist watches for daily wear.", 7499, "1523275335684-37898b6baf30", 2],
    ],
    ticker: ["Home try-on", "Prescription included", "Polarised", "1-year warranty"],
    lookbook: ["Details matter", [["1511499767150-a48a237f0083", "Round sunglasses"], ["1524592094714-0f0654e20314", "Watch held in a hand"], ["1574258495973-f010dfbb5371", "Glasses on a white surface"], ["1508685096489-7aacd43bd3b1", "Smartwatch on a wrist"], ["1523275335684-37898b6baf30", "White watches"]]],
    faq: ["How do I send my prescription?", "Upload a photo of it at checkout, or email it to us after ordering."],
  }),
  glassTemplate({
    id: "folio", name: "Folio stationery & art", category: "Stationery & art", storeName: "Folio", palette: "violet", accent: "#5b34d6", fontPair: "startup", hero: "split", heroDecor: "mesh",
    description: "Creative violet glass for notebooks, pens, prints and desk goods.",
    image: "1513519245088-0e12902e5a38", storyImage: "1456735190827-d1262f71b8a3",
    eyebrow: "For makers and note-takers", heading: "Paper that sparks ideas.", sub: "Notebooks, pens, art prints and desk essentials for people who still love writing by hand.",
    announcement: "Free bookmark with every order · Gift wrap available",
    story: { eyebrow: "Made for writing", heading: "Paper you can feel", body: "[Replace with your story] We choose thick, smooth paper that takes fountain-pen ink without bleeding — and bind it to lie flat.", bullets: ["100 GSM fountain-pen friendly", "Lay-flat binding", "Recycled card covers"] },
    extra: { icon: "palette", title: "Gift wrap", body: "Add wrapping and a handwritten note at checkout." },
    collections: [["Notebooks", "Lined, dotted and plain.", "1531346878377-a5be20888e57"], ["Pens & tools", "For writing and making.", "1456735190827-d1262f71b8a3"], ["Art prints", "For walls that talk.", "1513519245088-0e12902e5a38"]],
    products: [
      ["Lay-flat dotted notebook", "A5, 160 pages of 100 GSM paper with a linen cover.", 649, "1531346878377-a5be20888e57", 0],
      ["Writer's journal & fountain pen", "A lined journal with a brass-trim fountain pen.", 1499, "1517842645767-c639042777db", 0, 1799],
      ["Maker's supply box", "Pens, markers and sticky notes in a travel case.", 1199, "1456735190827-d1262f71b8a3", 1],
      ["Gallery wall print set", "Eight art prints in mixed sizes, ready to frame.", 2499, "1513519245088-0e12902e5a38", 2],
    ],
    ticker: ["Fountain-pen friendly", "Lay-flat binding", "Free bookmark", "Gift wrap"],
    lookbook: ["On the desk", [["1513519245088-0e12902e5a38", "A gallery wall of prints"], ["1517842645767-c639042777db", "Journal with a fountain pen"], ["1456735190827-d1262f71b8a3", "Stationery in a case"], ["1531346878377-a5be20888e57", "Notebook and pen"], ["1452860606245-08befc0ff44b", "Craft tools on a cutting mat"]]],
    faq: ["Is the paper fountain-pen friendly?", "Yes — our notebooks use 100 GSM paper that handles most inks without bleeding."],
  }),
  glassTemplate({
    id: "aurum", name: "Aurum fine jewellery", category: "Fine jewellery", storeName: "AURUM", palette: "midnight", accent: "#d4af37", fontPair: "luxury", hero: "overlay",
    description: "Midnight-and-gold glass for diamonds, gold and everyday fine jewellery.",
    image: "1605100804763-247f67b3557e", storyImage: "1599459183200-59c7687a0275",
    eyebrow: "Certified fine jewellery", heading: "Light, held forever.", sub: "Diamond rings, gold chains and pearls — hallmarked, certified and made to be worn every day.",
    announcement: "Free insured shipping · Lifetime cleaning & polishing",
    story: { eyebrow: "Crafted to last", heading: "Every stone, accounted for", body: "[Replace with your story] Each piece is hallmarked and every diamond comes with its certificate. Set by hand in our own workshop, finished to sit perfectly on the skin.", bullets: ["BIS hallmarked gold", "Certified diamonds", "Lifetime polishing"] },
    extra: { icon: "shield", title: "Certified & insured", body: "Every order ships fully insured, with its certificate in the box." },
    collections: [["Rings", "Solitaires and bands.", "1603561591411-07134e71a2a9"], ["Necklaces & earrings", "Pendants, pearls and drops.", "1588444837495-c6cfeb53f32d"], ["Bracelets", "Tennis and chain styles.", "1573408301185-9146fe634ad0"]],
    products: [
      ["Halo diamond ring", "A brilliant-cut centre stone in a halo of pavé diamonds, 18k white gold.", 48999, "1605100804763-247f67b3557e", 0, 54999, false, ["Ring size", ["10", "12", "14", "16"]]],
      ["Pink sapphire cocktail ring", "An emerald-cut pink sapphire framed in diamonds on a rose-gold band.", 39999, "1603561591411-07134e71a2a9", 0],
      ["Classic tennis bracelet", "A continuous line of matched diamonds with a hidden safety clasp.", 64999, "1573408301185-9146fe634ad0", 2],
      ["Sapphire drop earrings", "Pear-cut blue sapphires beneath baguette diamonds.", 34999, "1535632066927-ab7c9ab60908", 1],
      ["Open heart pendant", "A delicate pavé heart on a fine sterling chain.", 12999, "1588444837495-c6cfeb53f32d", 1],
      ["Freshwater pearl strand", "Hand-knotted freshwater pearls with a white-gold clasp, in its gift box.", 18999, "1515562141207-7a88fb7ce338", 1],
    ],
    ticker: ["Hallmarked gold", "Certified diamonds", "Insured shipping", "Lifetime polishing"],
    lookbook: ["Worn every day", [["1599459183200-59c7687a0275", "Layered gold necklaces"], ["1596944924616-7b38e7cfac36", "Hands wearing fine bracelets"], ["1605100804763-247f67b3557e", "A halo diamond ring"], ["1535632066927-ab7c9ab60908", "Sapphire drop earrings"], ["1573408301185-9146fe634ad0", "A diamond bracelet"]]],
    faq: ["Do your pieces come certified?", "[Edit to match your pieces] Yes — gold is BIS hallmarked and every diamond ships with its certificate."],
  }),
  glassTemplate({
    id: "kundan", name: "Kundan bridal jewellery", category: "Bridal & heritage jewellery", storeName: "Kundan House", palette: "saffron", accent: "#b45309", fontPair: "classic", hero: "overlay",
    description: "Warm saffron glass for bridal sets, temple gold and heirloom pieces.",
    image: "1601121141461-9d6647bca1ed", storyImage: "1606760227091-3dd870d97f1d",
    eyebrow: "Bridal & heritage", heading: "Heirlooms for your big day.", sub: "Kundan and polki sets, temple gold and bangles — handcrafted by karigars for weddings and every celebration after.",
    announcement: "Book a video consultation · Free insured shipping across India",
    story: { eyebrow: "Made by hand", heading: "Three generations of karigars", body: "[Replace with your story] Every set is made by hand in our workshop — stones set one by one, gold finished the traditional way, and checked before it reaches you.", bullets: ["Handcrafted by karigars", "Hallmarked gold", "Bridal styling help"] },
    extra: { icon: "heart", title: "Bridal styling", body: "Book a free video call to match sets to your outfits." },
    collections: [["Necklace sets", "Kundan, polki and temple.", "1601121141461-9d6647bca1ed"], ["Bangles & bracelets", "Gold and rose gold.", "1602173574767-37ac01994b2a"], ["Rings & earrings", "Statement and stackable.", "1543294001-f7cd5d7fb516"]],
    products: [
      ["Kundan bridal necklace set", "A grand collar necklace with matching jhumkas, ruby and emerald drops.", 89999, "1601121141461-9d6647bca1ed", 0, 99999],
      ["Temple gold chain bracelet", "A heavy link bracelet in 22k-finish gold.", 24999, "1602173574767-37ac01994b2a", 1],
      ["Rose gold filigree bangle", "Openwork filigree on a slim rose-gold bangle.", 19999, "1611591437281-460bfbe1220a", 1, null, false, ["Size", ["2.4", "2.6", "2.8"]]],
      ["Polki stacking rings (pair)", "Two uncut-diamond bands that sit together or alone.", 15999, "1543294001-f7cd5d7fb516", 2],
      ["Gold drop earrings", "Light, everyday hoops with a hammered finish.", 9999, "1617038220319-276d3cfab638", 2],
    ],
    ticker: ["Handcrafted", "Hallmarked gold", "Bridal consultations", "Insured shipping"],
    lookbook: ["Made for celebrations", [["1601121141461-9d6647bca1ed", "A kundan necklace set"], ["1606760227091-3dd870d97f1d", "A spread of gold and silver jewellery"], ["1596944924616-7b38e7cfac36", "Hands wearing gold bracelets"], ["1611591437281-460bfbe1220a", "A rose gold bangle"], ["1543294001-f7cd5d7fb516", "Stacked gold rings"]]],
    faq: ["Can I see a set before I buy?", "[Edit to match your service] Yes — book a free video consultation and we'll show you any piece up close."],
  }),
  glassTemplate({
    id: "crumb", name: "Crumb artisan bakery", category: "Bakery & cakes", storeName: "Crumb", palette: "clay", accent: "#8a4b2a", fontPair: "editorial", hero: "overlay",
    description: "Warm clay glass for sourdough, celebration cakes and bake boxes.",
    image: "1517433670267-08bbd4be890f", storyImage: "1586985289688-ca3cf47d3e6e",
    eyebrow: "Baked this morning", heading: "Slow dough. Warm crumbs.", sub: "Naturally leavened bread, celebration cakes and cookie boxes — baked in small batches and delivered fresh.",
    announcement: "Order by 6 pm for tomorrow · Free delivery over ₹799",
    story: { eyebrow: "Our bakehouse", heading: "Flour, water, salt and time", body: "[Replace with your story] Our sourdough rests for 36 hours, our butter is real and our cakes are made to order — never frozen, never rushed.", bullets: ["36-hour sourdough", "Made to order", "No preservatives"] },
    extra: { icon: "clock", title: "Fresh every day", body: "Order by 6 pm and we bake it for you overnight." },
    collections: [["Breads", "Sourdough and rye.", "1509440159596-0249088772ff"], ["Cakes", "For every celebration.", "1578985545062-69928b1d9587"], ["Sweet bakes", "Cookies, brownies, cupcakes.", "1558961363-fa8fdf82db35"]],
    products: [
      ["Country sourdough loaf", "Our everyday loaf: crackling crust, open crumb, 36-hour ferment.", 349, "1549931319-a545dcf3bc73", 0],
      ["Rustic rye boule", "Dark rye with a hint of caraway, dense and full of flavour.", 299, "1509440159596-0249088772ff", 0],
      ["Chocolate truffle cake", "Dark chocolate sponge, ganache and a glossy drip.", 1499, "1578985545062-69928b1d9587", 1, null, false, ["Size", ["0.5 kg", "1 kg"]]],
      ["Funfetti celebration cake", "Vanilla sponge full of sprinkles with strawberry frosting.", 1899, "1621303837174-89787a7d4729", 1, 2199],
      ["Brown-butter cookie box", "Twelve chunky chocolate-chip cookies made with brown butter.", 549, "1558961363-fa8fdf82db35", 2],
      ["Fudgy brownie box", "Nine dense, crackle-top brownies.", 599, "1606313564200-e75d5e30476c", 2],
      ["Cookies & cream cupcakes (6)", "Chocolate cupcakes with a whipped cookie frosting.", 699, "1612203985729-70726954388c", 2],
    ],
    ticker: ["36-hour sourdough", "Made to order", "Fresh every morning", "Free delivery over ₹799"],
    lookbook: ["From our ovens", [["1568254183919-78a4f43a2877", "A bakery counter full of pastries"], ["1608198093002-ad4e005484ec", "Freshly baked breads and buns"], ["1464305795204-6f5bbfc7fb81", "Lattice berry pies"], ["1550617931-e17a7b70dce2", "Frosted chocolate cupcakes"], ["1586985289688-ca3cf47d3e6e", "A cake being iced"]]],
    faq: ["Can I order a cake for a date?", "[Edit to match your settings] Yes — add the date and message in the order note, at least 24 hours ahead."],
  }),
];

export const storeTemplate = (id: string) => STORE_TEMPLATES.find((t) => t.id === id);

/** Templates in the order people should see them: signature (modern) looks first. */
export const STORE_TEMPLATES_SHOWN = [...STORE_TEMPLATES.filter((t) => t.look), ...STORE_TEMPLATES.filter((t) => !t.look)];

/** Converts a sample INR price into the store currency (minor units), ending in .99 for decimal currencies. */
export function samplePrice(inr: number, currency: string): number {
  if (currency === "INR") return inr * 100;
  if (currency === "JPY") return Math.max(100, Math.round(inr * 1.8 / 10) * 10);
  const major = Math.max(1, Math.round(inr / 85));
  return major * 100 - 1;
}

const sec = (type: string, props: Record<string, unknown>, variant?: string): Section => {
  const s = createSection(type);
  Object.assign(s.props, props);
  if (variant) s.variant = variant;
  return s;
};

/** Builds the storefront site document for a template. */
export function storeSiteDoc(t: StoreTemplate, storeName = t.storeName): SiteDoc {
  const links = [
    { label: "Shop all", href: "/shop" },
    ...t.collections.slice(0, 2).map((c) => ({ label: c.title, href: `/shop/${slugifyTitle(c.title)}` })),
    { label: "Track order", href: "/track" },
  ];
  const policies = [
    { label: "Shipping", href: "/policies/shipping" },
    { label: "Refunds", href: "/policies/refund" },
    { label: "Privacy", href: "/policies/privacy" },
    { label: "Terms", href: "/policies/terms" },
  ];
  const sections: Section[] = [
    sec("banner", { text: t.announcement, linkLabel: "Shop now", linkHref: "/shop" }),
    sec("navbar", { brand: storeName, links, ctaLabel: "Shop now", ctaHref: "/shop", showCart: true }),
    sec("hero", { eyebrow: t.eyebrow, heading: t.heading, subheading: t.sub, primaryLabel: "Shop the collection", primaryHref: "/shop", secondaryLabel: "Delivery & returns", secondaryHref: "/#faq", image: photoUrl(t.image, 2000), imageAlt: `${storeName} — ${t.eyebrow.toLowerCase()}`, layout: "split" }),
    sec("collectionList", { heading: "Shop by category", limit: 6 }),
    sec("productGrid", { heading: "Bestsellers", subheading: "Our most-loved pieces, ready to ship.", collection: "", sort: "featured", limit: 8, buttonLabel: "Shop all" }),
    sec("features", { heading: "Why shop with us", subheading: "", items: t.promises }),
    sec("split", { eyebrow: t.story.eyebrow, heading: t.story.heading, body: t.story.body, bullets: t.story.bullets, image: photoUrl(t.storyImage, 1400), imageAlt: t.story.heading, buttonLabel: "Shop now", buttonHref: "/shop" }, "image-left"),
    sec("productGrid", { heading: "New arrivals", subheading: "", collection: "", sort: "newest", limit: 4, buttonLabel: "See everything" }),
    sec("faq", { heading: "Good to know", items: t.faq }),
    sec("newsletter", { heading: "Be first to know", body: "New arrivals, restocks and members-only offers. Unsubscribe anytime.", buttonLabel: "Subscribe" }),
    sec("footer", { text: `© ${new Date().getFullYear()} ${storeName}. All rights reserved.`, links: [...links.slice(0, 1), ...policies] }),
  ];
  if (t.look) return modernSiteDoc(t, t.look, storeName, links, policies);
  const draft = {
    version: 1 as const,
    name: storeName,
    lang: "en",
    theme: themeFor(t.personality, { palette: t.palette }),
    pages: [{ id: newId("p"), path: "/", title: storeName, kind: "page" as const, description: `${storeName} — ${t.sub}`.slice(0, 160), sections }],
  };
  applyLayout(draft as SiteDoc, t.personality);
  // The announcement bar and hero keep their own styling after the layout pass.
  return siteDocSchema.parse(draft);
}

type Link = { label: string; href: string };

/** The modern storefront: a different rhythm, styled after the layout pass so nothing is overwritten. */
function modernSiteDoc(t: StoreTemplate, look: StoreLook, storeName: string, links: Link[], policies: Link[]): SiteDoc {
  const motion = { entrance: "up" as const, speed: "normal" as const, stagger: true, hover: "lift" as const, parallax: false };
  const hero = sec("hero", { eyebrow: t.eyebrow, heading: t.heading, subheading: t.sub, primaryLabel: "Shop the collection", primaryHref: "/shop", secondaryLabel: "Explore", secondaryHref: "/#lookbook", image: photoUrl(t.image, 2200), imageAlt: `${storeName} — ${t.eyebrow.toLowerCase()}` });
  const ticker = sec("marquee", { items: look.ticker.items, separator: "✦", speed: "slow", reverse: false }, look.ticker.variant);
  const edit = sec("productGrid", { heading: "The edit", subheading: "Our most-loved pieces, ready to ship.", collection: "", sort: "featured", limit: 7, buttonLabel: "Shop all" }, "editorial");
  const cats = sec("collectionList", { heading: "Shop by category", limit: 3 }, "tiles");
  const story = sec("split", { eyebrow: t.story.eyebrow, heading: t.story.heading, body: t.story.body, bullets: t.story.bullets, image: photoUrl(t.storyImage, 1400), imageAlt: t.story.heading, buttonLabel: "Shop now", buttonHref: "/shop" });
  const lookbook = sec("gallery", { heading: look.lookbook.heading, images: look.lookbook.photos.map((p) => ({ src: photoUrl(p.id, 1200), alt: p.alt })) }, "masonry");
  const promises = sec("features", { heading: "The small print, made big", subheading: "", items: t.promises });
  const fresh = sec("productGrid", { heading: "Just in", subheading: "", collection: "", sort: "newest", limit: 8, buttonLabel: "See everything" }, "carousel");
  const sections: Section[] = [
    sec("banner", { text: t.announcement, linkLabel: "Shop now", linkHref: "/shop" }),
    sec("navbar", { brand: storeName, links, ctaLabel: "Shop now", ctaHref: "/shop", showCart: true }),
    hero,
    ticker,
    edit,
    cats,
    story,
    lookbook,
    promises,
    fresh,
    sec("faq", { heading: "Good to know", items: t.faq }, "split"),
    sec("newsletter", { heading: "Be first in line", body: "New arrivals, restocks and members-only offers. Unsubscribe anytime.", buttonLabel: "Join the list" }, "card"),
    sec("footer", { text: `© ${new Date().getFullYear()} ${storeName}. All rights reserved.`, links: [...links.slice(0, 1), ...policies] }, "columns"),
  ];
  const draft = {
    version: 1 as const,
    name: storeName,
    lang: "en",
    theme: { ...themeFor(t.personality, { palette: t.palette, fontPair: look.fontPair }), motion: "expressive" as const, ...(look.ui ? { ui: look.ui } : {}) },
    pages: [{ id: newId("p"), path: "/", title: storeName, kind: "page" as const, description: `${storeName} — ${t.sub}`.slice(0, 160), sections }],
  };
  applyLayout(draft as SiteDoc, t.personality);
  // The signature look wins over the personality's defaults.
  hero.variant = look.hero;
  hero.style = { ...hero.style, decor: look.hero === "overlay" ? "none" : (look.heroDecor ?? hero.style.decor), motion: { ...motion, hover: "none", parallax: true } };
  ticker.variant = look.ticker.variant;
  ticker.style = { ...ticker.style, background: "default", paddingY: "sm" };
  edit.variant = "editorial";
  cats.variant = "tiles";
  fresh.variant = "carousel";
  lookbook.variant = "masonry";
  lookbook.style = { ...lookbook.style, adv: { ...(lookbook.style.adv ?? {}), anchor: "lookbook" } };
  story.variant = "image-left";
  story.style = { ...story.style, background: look.darkStory ? "inverse" : "surface", paddingY: "lg", motion: { ...motion, parallax: true } };
  promises.variant = "cards";
  for (const s of [edit, cats, lookbook, promises, fresh]) s.style = { ...s.style, motion };
  return siteDocSchema.parse(draft);
}

export function slugifyTitle(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}
