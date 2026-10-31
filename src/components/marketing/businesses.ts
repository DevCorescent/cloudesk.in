// One page per kind of business (/for/<slug>): how Cloudesk is used there,
// told with real screenshots from the app's demo projects. Claims describe
// what's built; limits go under "Good to know".
import { Briefcase, Croissant, Dumbbell, Gem, type LucideIcon, Shirt, Sofa, Sparkles, Stethoscope, UtensilsCrossed } from "lucide-react";
import type { IndustryId } from "@/lib/workspace/modules";
import type { StackCard } from "./stack-hero";
import type { Chapter, Shot } from "./shot-tour";

type Tone = Chapter["tone"];
const s = (dir: string, name: string, alt: string): Shot => ({ src: `/marketing/${dir}/${name}.jpg`, w: 2880, h: 1800, alt });
const phone = (src: string, w: number, h: number, alt: string, side: "left" | "right" = "right") => ({ src: `/marketing/${src}.jpg`, w, h, alt, side });
const iphone = (src: string, alt: string, side: "left" | "right" = "right") => phone(src, 1206, 2622, alt, side);
const oldPhone = (src: string, alt: string, side: "left" | "right" = "right") => phone(src, 780, 1688, alt, side);

export type Business = {
  slug: string;
  name: string;
  /** Short form for buttons: "Start free as a …". */
  noun: string;
  icon: LucideIcon;
  tint: Tone;
  /** Homepage card photo (Unsplash, checked by hand). */
  photo: string;
  alt: string;
  /** Pre-picks this industry in onboarding. */
  industry: IndustryId;
  line: string;
  title: string;
  mark: string;
  lede: string;
  uses: string[];
  stack: StackCard[];
  /** Today, without it → with Cloudesk. */
  shifts: { before: string; after: string }[];
  day: Chapter[];
  /** Feature pages (slugs) that make up the toolkit. */
  toolkit: string[];
  goodToKnow: string[];
  faqs: { q: string; a: string }[];
};

export const BUSINESSES: Business[] = [
  {
    slug: "fashion",
    name: "Boutiques & fashion",
    noun: "boutique",
    icon: Shirt,
    tint: "lavender",
    photo: "1441986300917-64674bd600d8",
    alt: "A clothing boutique with shelves and rails",
    industry: "retail",
    line: "Online store, sizes & colours, a till for the shop floor",
    title: "Your boutique, online and on the shop floor.",
    mark: "online and on the shop floor",
    lede: "A storefront that looks like a label, sizes and colours that never oversell, and a till that beeps through barcodes at the counter — all drawing from one stock.",
    uses: ["Online store", "Sizes & colours", "Point of sale"],
    stack: [
      { label: "Storefront", shot: s("store", "sf-home", "A Noir fashion storefront with a full-bleed hero") },
      { label: "Products", shot: s("store", "editor", "The product editor with photos, sizes and colours") },
      { label: "Counter till", shot: s("pos", "till", "The point-of-sale till with a sale in progress paid by UPI") },
      { label: "Price tags", shot: s("pos", "labels", "Barcode price labels for every size") },
      { label: "Orders", shot: s("store", "orders", "Paid and delivered orders") },
    ],
    shifts: [
      { before: "Orders arrive on Instagram DMs and get lost", after: "A real checkout with UPI, cards and cash on delivery" },
      { before: "The last medium sells twice — once online, once in store", after: "One stock for the website and the counter" },
      { before: "Handwritten tags and a calculator at the till", after: "Printed barcode tags and a till that scans them" },
    ],
    day: [
      { key: "store", eyebrow: "9:00 · Doors open online", title: "A storefront that looks like your label.", mark: "looks like your label", body: "Pick a signature design, add your lookbook and go live. Shoppers browse on their phones, pick a size and pay.", bullets: ["Designs made for fashion", "Lookbooks and collections", "UPI, cards and cash on delivery"], tone: "lavender", shot: s("store", "sf-home", "A Noir storefront with a full-bleed hero image"), detail: oldPhone("store/sf-phone", "The storefront on a phone") },
      { key: "variants", eyebrow: "11:00 · New arrivals", title: "Sizes and colours, without the spreadsheet.", mark: "without the spreadsheet", body: "Add a kurta in S to XL and three colours; each combination gets its own stock and price. Or import your whole list from Excel.", bullets: ["Variants with their own stock", "Excel and CSV import", "Low-stock warnings"], tone: "sky", shot: s("store", "editor", "The product editor with photos, options and labels") },
      { key: "till", eyebrow: "13:00 · The lunch rush", title: "Beep, bill, done — at the counter.", mark: "at the counter", body: "Scan the tag with any USB or Bluetooth scanner, take UPI with a QR for the exact amount, and print a GST receipt.", bullets: ["Scanner or phone camera", "UPI QR for the exact total", "One stock with the website"], tone: "mint", shot: s("pos", "till", "The till with product photos and a sale in progress"), detail: oldPhone("pos/phone", "The till on a phone") },
      { key: "labels", eyebrow: "16:00 · Restocking", title: "Price tags that scan.", mark: "that scan", body: "We create barcodes for every size and colour and print tags on thermal rolls or A4 sheets.", bullets: ["Thermal rolls or A4 sheets", "Name, price, MRP, barcode", "Exact print preview"], tone: "butter", shot: s("pos", "labels", "The Labels and barcodes page with a preview") },
      { key: "orders", eyebrow: "19:00 · Packing", title: "Every order, from paid to delivered.", mark: "paid to delivered", body: "Pack, book a Shiprocket pickup and send tracking — the customer gets their updates without you copy-pasting.", bullets: ["Shiprocket pickups", "GST invoices per order", "Returns and refunds"], tone: "peach", shot: s("store", "orders", "The orders list with paid and delivered orders") },
    ],
    toolkit: ["online-store", "point-of-sale", "promotions", "invoicing", "growth", "domains"],
    goodToKnow: ["The till records card and UPI payments taken on your own machine or app; it doesn't drive card terminals.", "Shipping bookings use your own Shiprocket account."],
    faqs: [
      { q: "Can I sell on Instagram and WhatsApp too?", a: "Yes — share product links anywhere, and connect WhatsApp Business for order updates." },
      { q: "Will it work with my existing barcodes?", a: "Yes. Keep the barcodes on your packs, or let us create in-store ones for items that don't have any." },
      { q: "Can I move from Shopify?", a: "Import your products from a Shopify CSV export — sizes and colours come across as variants." },
    ],
  },
  {
    slug: "bakery-cafe",
    name: "Bakeries & cafés",
    noun: "bakery or café",
    icon: Croissant,
    tint: "butter",
    photo: "1555507036-ab1f4038808a",
    alt: "Fresh croissants dusted with flour",
    industry: "food",
    line: "Counter billing, online orders, QR menus for tables",
    title: "From the oven to the counter to their door.",
    mark: "to their door",
    lede: "Take pre-orders online, bill the queue at the counter, let café guests order from a QR on their table — and turn first-time visitors into regulars with a welcome offer.",
    uses: ["Counter billing", "Online orders", "QR table menu"],
    stack: [
      { label: "Welcome offer", shot: s("promotions", "popup", "A 10% off sign-up pop-up on The Bread Room's home page") },
      { label: "Counter", shot: s("pos", "till", "The counter till with a sale in progress") },
      { label: "POS", shot: s("horeca", "pos", "The full-screen POS with dish codes and a ticket") },
      { label: "QR menu", shot: s("horeca", "qr-design", "QR menu options with a live phone preview") },
      { label: "Kitchen", shot: s("horeca", "kitchen", "Kitchen tickets with timers") },
      { label: "Cart add-ons", shot: s("promotions", "cart", "A cart with a free-delivery bar and suggested add-ons") },
    ],
    shifts: [
      { before: "Cake orders taken on the phone and scribbled down", after: "Pre-orders online, paid in advance" },
      { before: "A queue at the counter while you add up the bill", after: "Tap the photo, take UPI, print the receipt" },
      { before: "Café guests waving for the menu", after: "They scan, order and ask for the bill from the table" },
    ],
    day: [
      { key: "offer", eyebrow: "7:30 · First customers", title: "A welcome offer that brings them back.", mark: "brings them back", body: "A gentle pop-up offers first-time visitors 10% off in return for their email. You see how many saw it and signed up.", bullets: ["Pop-ups, bars and offers", "Codes made for you", "Views and sign-ups, counted"], tone: "rose", shot: s("promotions", "popup", "A 10% off pop-up on The Bread Room's home page"), detail: { src: "/marketing/promotions/photo-panel.jpg", w: 896, h: 876, alt: "The pop-up's photo and wording", side: "right" } },
      { key: "counter", eyebrow: "9:00 · The morning queue", title: "Tap, take UPI, next please.", mark: "next please", body: "Tap the product photos — or scan a barcode — and the customer scans a UPI QR for the exact amount. Change for cash is worked out for you.", bullets: ["Photo tiles for quick taps", "UPI QR, cash and card", "GST receipts"], tone: "mint", shot: s("pos", "till", "The till with product photos and a sale in progress"), detail: { src: "/marketing/pos/receipt.jpg", w: 840, h: 1160, alt: "A printed 80 mm receipt with the tax split", side: "right" } },
      { key: "qr", eyebrow: "11:00 · Brunch tables", title: "Guests order from a QR on their table.", mark: "a QR on their table", body: "Every table gets its own code. The menu opens on their phone with photos and veg marks; the order lands in the kitchen.", bullets: ["No app to download", "Add-ons like milk or size", "Call waiter and ask for the bill"], tone: "peach", shot: s("horeca", "qr-design", "QR menu options with a live phone preview"), detail: iphone("horeca/phone-addons", "Choosing options for a dish on the QR menu") },
      { key: "kitchen", eyebrow: "12:30 · Kitchen", title: "Tickets by station, timed to the minute.", mark: "timed to the minute", body: "The coffee bar and the kitchen each see their own tickets, with how long they've been waiting.", bullets: ["Stations like bar and kitchen", "Late tickets turn red", "Bump a ticket in one tap"], tone: "sky", shot: s("horeca", "kitchen", "Kitchen tickets in New, Cooking and Ready columns") },
      { key: "online", eyebrow: "18:00 · Tomorrow's orders", title: "Online orders that sell a little more.", mark: "sell a little more", body: "A free-delivery bar and “pairs well with” suggestions nudge the basket up — then orders arrive ready to bake.", bullets: ["Free-delivery progress bar", "Suggested add-ons", "Cart reminders"], tone: "butter", shot: s("promotions", "cart", "A cart with a free-delivery progress bar and suggested add-ons") },
    ],
    toolkit: ["point-of-sale", "online-store", "horeca", "promotions", "invoicing", "website-builder"],
    goodToKnow: ["Kitchen tickets show on a screen; there's no direct link to thermal kitchen printers yet.", "UPI on the QR menu opens the guest's UPI app; staff confirm the payment."],
    faqs: [
      { q: "Can customers order cakes for a date?", a: "Yes — add a note or a date field on the product and it comes through with the order." },
      { q: "Do I need the QR menu if I only do takeaway?", a: "No. Switch it off; the counter till and online orders work on their own." },
      { q: "Does it print bills?", a: "Yes, 80 mm receipts from the browser, with your GSTIN and the tax split." },
    ],
  },
  {
    slug: "restaurants-hotels",
    name: "Restaurants & hotels",
    noun: "restaurant or hotel",
    icon: UtensilsCrossed,
    tint: "peach",
    photo: "1517248135467-4c7edcad34c4",
    alt: "A warmly lit restaurant dining room",
    industry: "restaurant",
    line: "QR ordering, kitchen display, rooms, bar stock, valet",
    title: "Tables, kitchen, rooms and bar — on one screen.",
    mark: "on one screen",
    lede: "Cloudesk for Horeca runs service end to end: QR ordering at every table, a kitchen display, GST bills, room bookings with folios, bar stock to the millilitre and valet parking.",
    uses: ["QR ordering", "Kitchen display", "Rooms & bar"],
    stack: [
      { label: "POS", shot: s("horeca", "pos", "The full-screen POS with a table's ticket") },
      { label: "Today", shot: s("horeca", "overview", "The Horeca overview with today's sales and the live floor") },
      { label: "Floor", shot: s("horeca", "floor", "The floor plan with an open order") },
      { label: "Kitchen", shot: s("horeca", "kitchen", "The kitchen display") },
      { label: "Rooms", shot: s("horeca", "rooms", "The room booking calendar") },
      { label: "Bar", shot: s("horeca", "bar", "Bar stock by bottle") },
      { label: "Valet", shot: s("horeca", "valet", "The valet board") },
    ],
    shifts: [
      { before: "Waiters run orders to the kitchen on paper", after: "Orders land on the kitchen display, by station" },
      { before: "Room service gets forgotten at checkout", after: "Charged to the room and on the folio automatically" },
      { before: "Bottles disappear and nobody knows where", after: "Every peg deducted; counts show what's missing" },
    ],
    day: [
      { key: "pos", eyebrow: "11:45 · Till opens", title: "Staff unlock the POS with their own PIN.", mark: "their own PIN", body: "A full-screen POS for dine-in, takeaway, delivery and room service. Type a dish's short code, send the KOT and take payment; cancelling a dish waits for a manager's PIN.", bullets: ["Open the till with a float", "Short codes and covers", "Manager approval for voids and discounts"], tone: "lavender", shot: s("horeca", "pos", "The full-screen POS with table T4's ticket"), detail: { src: "/marketing/horeca/approval-panel.jpg", w: 680, h: 996, alt: "Manager approval PIN pad", side: "right" } },
      { key: "qr", eyebrow: "12:00 · Lunch service", title: "Guests scan, order and ask for the bill.", mark: "ask for the bill", body: "Each table has its own QR. Orders go straight to the kitchen — or a waiter confirms them first.", bullets: ["Auto or waiter-approved", "Live order tracking", "Your colours and tips"], tone: "peach", shot: s("horeca", "qr-design", "QR menu options with a live phone preview"), detail: iphone("horeca/phone-menu", "The guest QR menu on a phone") },
      { key: "floor", eyebrow: "13:00 · The floor", title: "Every table, live — down to who's calling.", mark: "who's calling", body: "See what's cooking, what's ready and which table wants the bill. Split bills, add service charge, take UPI or charge it to a room.", bullets: ["Split and part payments", "GST and service charge", "Charge to room"], tone: "sky", shot: s("horeca", "floor", "The floor plan with table T5's order open") },
      { key: "kitchen", eyebrow: "13:15 · Kitchen", title: "Tickets by station, timed to the minute.", mark: "timed to the minute", body: "Kitchen, tandoor, bar and desserts each see their own tickets. Late ones turn red.", bullets: ["Bump a ticket or a dish", "Full screen for a kitchen TV", "Optional chime"], tone: "mint", shot: s("horeca", "kitchen", "Kitchen tickets with station and timer") },
      { key: "rooms", eyebrow: "15:00 · Check-ins", title: "Bookings, check-in and the guest's folio.", mark: "the guest's folio", body: "A calendar of every room, availability by type, and one folio with nights, room GST, extras and room service.", bullets: ["Check-out warns while money is due", "Housekeeping board", "Printable folio"], tone: "lavender", shot: s("horeca", "rooms", "The room booking calendar"), detail: { src: "/marketing/horeca/folio-panel.jpg", w: 1176, h: 1132, alt: "A suite's folio with extras and an advance", side: "right" } },
      { key: "bar", eyebrow: "23:30 · Closing count", title: "Count the shelf. See what went missing.", mark: "what went missing", body: "Drinks deduct their pour from stock. Count at closing and see the variance in ml and money.", bullets: ["Purchases and wastage", "Reorder levels", "Every count kept"], tone: "rose", shot: s("horeca", "bar-counts", "A closing count with the variance") },
      { key: "valet", eyebrow: "23:45 · Going home", title: "“Bring my car” — from the guest's phone.", mark: "from the guest's phone", body: "Guests tap once when they're leaving and it jumps to the top of the valet board.", bullets: ["Tickets with slot and key tag", "Pre-booking link", "Free slots at a glance"], tone: "butter", shot: s("horeca", "valet", "The valet board"), detail: iphone("horeca/phone-valet", "The guest's valet page") },
    ],
    toolkit: ["horeca", "invoicing", "promotions", "website-builder", "growth", "bookings"],
    goodToKnow: ["Printing is from the browser — there's no direct link to thermal printers yet.", "Room bookings don't sync with online travel agents yet.", "Valet guests see updates on their page; there are no SMS alerts yet."],
    faqs: [
      { q: "Do guests need an app?", a: "No. They scan the code and the menu opens in their browser." },
      { q: "We're a café without rooms — is it too much?", a: "Rooms, bar and valet are sections you simply don't use; switch them off in Settings → Features." },
      { q: "Can a waiter check QR orders first?", a: "Yes — turn on “Waiter confirms” and QR orders wait for a tap before going to the kitchen." },
    ],
  },
  {
    slug: "salon-spa",
    name: "Salons & spas",
    noun: "salon or spa",
    icon: Sparkles,
    tint: "rose",
    photo: "1540555700478-4be289fbecef",
    alt: "Spa towels, a candle and pink tulips",
    industry: "salon",
    line: "Online bookings, follow-ups, retail at the desk",
    title: "A fully booked week, without the phone tag.",
    mark: "without the phone tag",
    lede: "Clients pick a service and a free slot from their phone, get their confirmation and follow-ups automatically, and you sell your retail range at the desk from the same app.",
    uses: ["Online bookings", "Follow-ups", "Invoices"],
    stack: [
      { label: "Services", shot: s("bookings", "services", "Spa services with duration and price") },
      { label: "Booking", shot: s("bookings", "slots", "Choosing a day and time for hot stone therapy") },
      { label: "Calendar", shot: s("bookings", "upcoming", "Upcoming appointments by day") },
      { label: "Follow-ups", shot: s("automations", "list", "Four automations for a spa") },
      { label: "Your site", shot: s("builder", "mobile", "A spa homepage in the phone preview") },
    ],
    shifts: [
      { before: "Calls and DMs to find a free slot", after: "Clients book a free slot themselves, any hour" },
      { before: "Thank-yous and rebooking nudges forgotten in the rush", after: "Follow-ups go out on their own after every booking" },
      { before: "A separate notebook for product sales", after: "Retail at the desk, on the same app" },
    ],
    day: [
      { key: "site", eyebrow: "Sunday night · Browsing", title: "A site as calm as your space.", mark: "as calm as your space", body: "A beautiful spa site with your services and prices — edited by clicking on it, and perfect on phones.", bullets: ["Designed for phones first", "Edit any text in place", "Your own domain"], tone: "rose", shot: s("builder", "mobile", "A spa homepage in the builder's phone preview"), detail: { src: "/marketing/builder/phone.jpg", w: 812, h: 1200, alt: "A spa homepage on a phone", side: "right" } },
      { key: "book", eyebrow: "Sunday 11 pm · Booking", title: "They book the slot themselves.", mark: "book the slot themselves", body: "Clients pick a service, a day and a free time — only real availability is shown, with your rules for notice and buffers.", bullets: ["Real free slots only", "Durations and buffers", "Pay now or at the visit"], tone: "sky", shot: s("bookings", "slots", "Choosing a day and a time for hot stone therapy"), detail: oldPhone("bookings/phone-slots", "Booking a slot on a phone") },
      { key: "calendar", eyebrow: "Monday 9:00 · The week", title: "Your week, already filled in.", mark: "already filled in", body: "Every appointment by day, with the client's details and what they booked.", bullets: ["Confirmed and pending", "Opening hours per day", "Holidays blocked out"], tone: "mint", shot: s("bookings", "upcoming", "The bookings calendar with appointments by day") },
      { key: "remind", eyebrow: "Monday 10:00 · Follow-ups", title: "Follow-ups that go out on their own.", mark: "go out on their own", body: "A thank-you a day after the visit, a nudge to rebook a few weeks later, a ping to your team on Slack — set once, runs after every booking.", bullets: ["Email, Slack and webhooks", "Waits and conditions", "Every run logged"], tone: "lavender", shot: s("automations", "list", "Four automations for a spa with their triggers and runs") },
    ],
    toolkit: ["bookings", "automations", "website-builder", "point-of-sale", "invoicing", "promotions"],
    goodToKnow: ["Follow-ups run after a booking; reminders timed before an appointment aren't built yet.", "Bookings are per business; separate calendars per staff member aren't built yet."],
    faqs: [
      { q: "Can clients pay when they book?", a: "Yes — online at booking, or at the visit. You choose per service." },
      { q: "Can I block holidays?", a: "Yes, set opening hours per day and block out dates." },
      { q: "Can I sell products at the desk?", a: "Yes, switch on Point of sale for retail with barcodes." },
    ],
  },
  {
    slug: "jewellery",
    name: "Jewellery",
    noun: "jeweller",
    icon: Gem,
    tint: "lavender",
    photo: "1599643478518-a784e5dc4c8f",
    alt: "A gold necklace in soft light",
    industry: "retail",
    line: "Online store, barcode tags, GST invoices",
    title: "Every piece tagged, tracked and beautifully shown.",
    mark: "beautifully shown",
    lede: "A storefront that shows each piece off, a barcode on every tag, a till for the counter and proper GST invoices for your business buyers.",
    uses: ["Online store", "Price labels", "Barcodes"],
    stack: [
      { label: "Product page", shot: s("store", "sf-product", "A product page with options, stock left and add to cart") },
      { label: "Design", shot: s("store", "picker", "Choosing a store design") },
      { label: "Tags", shot: s("pos", "labels", "Barcode labels") },
      { label: "Counter", shot: s("pos", "till", "The till") },
      { label: "Invoice", shot: s("finance", "doc", "A GST tax invoice") },
    ],
    shifts: [
      { before: "Photos on WhatsApp and prices on request", after: "Each piece on its own page with stock left" },
      { before: "Tags written by hand", after: "Barcode tags that scan at the counter" },
      { before: "Invoices typed in Word for B2B buyers", after: "GST invoices with the buyer's GSTIN in a minute" },
    ],
    day: [
      { key: "design", eyebrow: "Launch day · The look", title: "A store that looks expensive on day one.", mark: "expensive on day one", body: "Pick a signature design, preview it with your own name and pieces, and launch.", bullets: ["Designs for premium brands", "Your colours from your logo", "Live preview"], tone: "lavender", shot: s("store", "picker", "Choosing a store design, with signature templates first") },
      { key: "product", eyebrow: "Every day · Online", title: "Each piece, on its own stage.", mark: "on its own stage", body: "Big photos, options like size or finish, and honest stock — so a one-of-a-kind piece never sells twice.", bullets: ["Options with their own stock", "Stock left shown", "Share links for WhatsApp"], tone: "rose", shot: s("store", "sf-product", "A product page with sizes, stock left and add to cart") },
      { key: "tags", eyebrow: "Stock-in · Tagging", title: "A barcode on every tag.", mark: "on every tag", body: "Print small tags on thermal rolls with name, price and barcode — and scan them at the counter.", bullets: ["Small thermal sizes", "Name, price, MRP", "Exact print preview"], tone: "butter", shot: s("pos", "labels", "The Labels and barcodes page with a preview") },
      { key: "invoice", eyebrow: "Wholesale · Invoicing", title: "GST invoices for your business buyers.", mark: "business buyers", body: "CGST, SGST or IGST worked out from the buyer's state, a UPI QR to pay, and a link to share.", bullets: ["Buyer GSTIN", "Pay by UPI", "Part payments recorded"], tone: "sky", shot: s("finance", "doc", "A tax invoice with IGST, a UPI QR code and part-payment") },
    ],
    toolkit: ["online-store", "point-of-sale", "invoicing", "promotions", "domains", "growth"],
    goodToKnow: ["Prices are set per item; live gold-rate pricing isn't built.", "Hallmark and certificate numbers can go in the product description or a custom field."],
    faqs: [
      { q: "Can I hide prices for some pieces?", a: "Yes — in a catalogue you can show “price on request” and take quote requests instead." },
      { q: "Do the tags fit small jewellery?", a: "Pick a small thermal size like 38×25 mm; the preview shows exactly what prints." },
      { q: "Can I ship internationally?", a: "Yes, with prices in other currencies." },
    ],
  },
  {
    slug: "studios",
    name: "Studios & consultants",
    noun: "studio",
    icon: Briefcase,
    tint: "sky",
    photo: "1499951360447-b19be8fe80f5",
    alt: "A tidy desk with a laptop and a monitor",
    industry: "services",
    line: "A website that wins work, quotes, GST invoices",
    title: "Win the work, send the quote, get paid.",
    mark: "get paid",
    lede: "A portfolio site that brings enquiries, quotations that turn into invoices in a click, client review links, and GST invoices clients pay by UPI.",
    uses: ["Website", "Quotations", "GST invoices"],
    stack: [
      { label: "Quote", shot: s("finance", "quote", "A quotation with Convert to invoice") },
      { label: "Invoice", shot: s("finance", "editor", "The invoice editor with a live preview") },
      { label: "Client view", shot: s("finance", "public", "The client's invoice with Pay by UPI") },
      { label: "Review", shot: s("collaboration", "review", "A client review link") },
      { label: "Finance", shot: s("finance", "overview", "The Finance overview") },
    ],
    shifts: [
      { before: "Quotes in Word, invoices in Excel, chasing in WhatsApp", after: "Quote → invoice → payment in one place" },
      { before: "Clients review screenshots over email", after: "A review link with Approve and comments" },
      { before: "No idea who owes what", after: "What you're owed, overdue and collected — at a glance" },
    ],
    day: [
      { key: "quote", eyebrow: "Monday · A new lead", title: "A quote that turns into the invoice.", mark: "turns into the invoice", body: "Send a polished quotation by link. When it's accepted, convert it to an invoice in one click.", bullets: ["Your own format or our designs", "Share by link, email or WhatsApp", "Convert to invoice"], tone: "sky", shot: s("finance", "quote", "A quotation titled 2BHK full interiors with Convert to invoice") },
      { key: "review", eyebrow: "Wednesday · Client review", title: "Approvals without the email chain.", mark: "without the email chain", body: "Send a review link. Clients comment on the actual page and press Approve.", bullets: ["Comments pinned to sections", "Approve or request changes", "Nothing public until you publish"], tone: "lavender", shot: s("collaboration", "review", "A client review link with Approve and comment options") },
      { key: "invoice", eyebrow: "Friday · Billing", title: "GST invoices clients pay by UPI.", mark: "pay by UPI", body: "CGST/SGST or IGST worked out for you, a Pay by UPI button for the exact amount, and reminders when it's late.", bullets: ["Live preview while you type", "Pay by UPI and PDF", "Reminders"], tone: "mint", shot: s("finance", "editor", "The invoice editor with a live preview"), detail: { src: "/marketing/finance/phone.jpg", w: 1170, h: 1899, alt: "The client's invoice on a phone with Pay by UPI", side: "right" } },
      { key: "money", eyebrow: "Month end · The numbers", title: "Who owes what, and what came in.", mark: "what came in", body: "What you're owed, overdue and collected, a 12-month chart and receivables by age — ready for your accountant.", bullets: ["Reports to download", "Receivables by age", "Works without a website"], tone: "butter", shot: s("finance", "overview", "The Finance overview with a 12-month chart") },
    ],
    toolkit: ["invoicing", "website-builder", "collaboration", "automations", "chatbot", "domains"],
    goodToKnow: ["UPI payments are confirmed by you; there's no bank feed yet.", "Finance works on its own — you don't need a website to send invoices."],
    faqs: [
      { q: "Can I use my own invoice format?", a: "Yes — upload yours and we match it, or pick one of the designs." },
      { q: "Do I need a website?", a: "No. Finance works on its own; add a site whenever you like." },
      { q: "Can my team work in it too?", a: "Yes, with roles — billing staff can invoice without touching your site." },
    ],
  },
  {
    slug: "clinics",
    name: "Clinics",
    noun: "clinic",
    icon: Stethoscope,
    tint: "sky",
    photo: "1519494026892-80bbd2d6fd0d",
    alt: "A clean clinic reception desk",
    industry: "clinic",
    line: "Appointments, follow-ups, a chatbot for questions",
    title: "Appointments booked, questions answered — 24/7.",
    mark: "questions answered",
    lede: "Patients book a free slot online, get a confirmation email automatically, and a chatbot answers the usual questions — timings, parking, fees — from your own information.",
    uses: ["Website", "Appointments", "Contact forms"],
    stack: [
      { label: "Hours & rules", shot: s("bookings", "hours", "Weekly opening hours and booking rules") },
      { label: "Booking", shot: s("bookings", "slots", "Choosing a day and time") },
      { label: "Appointments", shot: s("bookings", "upcoming", "Upcoming appointments") },
      { label: "Chatbot", shot: s("chatbot", "setup", "The chatbot answering a parking question") },
      { label: "Follow-ups", shot: s("automations", "open", "An automation waiting on its delay step") },
    ],
    shifts: [
      { before: "The front desk phone never stops", after: "Patients book online, any time" },
      { before: "“Where do I park?” asked fifty times a day", after: "The chatbot answers from your own notes" },
      { before: "Calling every patient to confirm", after: "Confirmation and follow-up emails go out on their own" },
    ],
    day: [
      { key: "hours", eyebrow: "Setup · Your rules", title: "Your hours, your rules.", mark: "your rules", body: "Set opening hours per day, minimum notice and buffers — patients only see times that really work.", bullets: ["Hours per day", "Notice and buffers", "Holidays blocked"], tone: "sky", shot: s("bookings", "hours", "Weekly opening hours and booking rules") },
      { key: "book", eyebrow: "Evening · Booking", title: "Patients book the free slot themselves.", mark: "book the free slot", body: "Pick the consultation, a day and a time, and leave their details — no calls.", bullets: ["Real availability", "Their details in the form", "Pay online or at the visit"], tone: "mint", shot: s("bookings", "slots", "Choosing a day and a time"), detail: oldPhone("bookings/phone-services", "Choosing a service on a phone") },
      { key: "bot", eyebrow: "Any time · Questions", title: "A chatbot that knows your clinic.", mark: "knows your clinic", body: "It answers only from your own pages and notes — timings, parking, fees — and asks for an email when it isn't sure.", bullets: ["Learns from your site", "Test it before it goes live", "Conversations inbox"], tone: "lavender", shot: s("chatbot", "setup", "The chatbot settings with a test conversation answering a parking question") },
      { key: "remind", eyebrow: "After booking · Follow-ups", title: "Confirmations, without the calls.", mark: "without the calls", body: "A confirmation email when they book and a follow-up after the visit — set up once, runs every time.", bullets: ["Waits and conditions", "Every run logged", "Test with sample data"], tone: "rose", shot: s("automations", "open", "An automation's runs, waiting on their delay step") },
    ],
    toolkit: ["bookings", "chatbot", "automations", "website-builder", "invoicing", "domains"],
    goodToKnow: ["Cloudesk isn't a medical records system — don't store clinical notes or reports in it.", "The chatbot answers from your content; it doesn't give medical advice.", "Reminders timed before an appointment aren't built yet — follow-ups run after the booking."],
    faqs: [
      { q: "Can we have different consultation types?", a: "Yes — each with its own duration and fee." },
      { q: "What if the chatbot doesn't know?", a: "It says it isn't sure and asks the patient to leave an email so your team can reply — it never guesses. You see every conversation in the inbox." },
      { q: "Can patients pay online?", a: "Yes, at booking or at the visit — your choice." },
    ],
  },
  {
    slug: "home-decor",
    name: "Home & décor",
    noun: "home décor brand",
    icon: Sofa,
    tint: "mint",
    photo: "1555041469-a586c61ea9bc",
    alt: "A green velvet sofa in a bright room",
    industry: "home",
    line: "Online store, Shiprocket shipping, cash on delivery",
    title: "Big catalogue, careful shipping, bigger baskets.",
    mark: "bigger baskets",
    lede: "Bring hundreds of products from a spreadsheet, choose a design that suits your range, ship with Shiprocket and nudge carts up with a free-delivery bar.",
    uses: ["Online store", "Shiprocket shipping", "Cash on delivery"],
    stack: [
      { label: "Import", shot: s("launch", "products", "Bring your products: drop an Excel or CSV file") },
      { label: "Design", shot: s("store", "picker", "Choosing a store design") },
      { label: "Product page", shot: s("store", "sf-product", "A product page") },
      { label: "Cart", shot: s("promotions", "cart", "A cart with a free-delivery bar") },
      { label: "Orders", shot: s("store", "orders", "Orders") },
    ],
    shifts: [
      { before: "Hours typing products in one by one", after: "Drop your spreadsheet; we sort out the columns" },
      { before: "Small baskets and high delivery costs", after: "A free-delivery bar and suggested add-ons" },
      { before: "Copy-pasting addresses into the courier site", after: "Book Shiprocket pickups from the order" },
    ],
    day: [
      { key: "import", eyebrow: "Day one · Your range", title: "Your whole range, from one spreadsheet.", mark: "from one spreadsheet", body: "Drop any Excel or CSV — even messy ones with title rows. Sizes and finishes become variants; missing prices are flagged.", bullets: ["Messy sheets welcome", "Variants from columns", "Drafts for what's missing"], tone: "mint", shot: s("launch", "products", "Bring your products: drop an Excel or CSV file") },
      { key: "design", eyebrow: "Day one · The look", title: "A design that suits your range.", mark: "suits your range", body: "Preview designs with your own name and products, then launch.", bullets: ["Signature templates", "Colours from your logo", "Edit everything later"], tone: "peach", shot: s("store", "picker", "Choosing a store design, with signature templates first") },
      { key: "cart", eyebrow: "Every order · Basket", title: "Baskets that grow on their own.", mark: "grow on their own", body: "A free-delivery progress bar and “goes well with” suggestions in the cart.", bullets: ["Free-delivery bar", "Suggested add-ons", "Cart reminders"], tone: "butter", shot: s("promotions", "cart", "A cart with a free-delivery progress bar and suggested add-ons") },
      { key: "ship", eyebrow: "Dispatch · Shipping", title: "Ship without the copy-paste.", mark: "without the copy-paste", body: "Book a Shiprocket pickup from the order and the customer gets the tracking link.", bullets: ["Shiprocket pickups", "Cash on delivery", "GST invoice per order"], tone: "sky", shot: s("store", "orders", "The orders list with paid and delivered orders") },
    ],
    toolkit: ["online-store", "launch", "promotions", "growth", "invoicing", "domains"],
    goodToKnow: ["Shipping uses your own Shiprocket account and rates.", "Photos pasted inside Excel cells aren't imported; photo links are."],
    faqs: [
      { q: "Can I offer cash on delivery?", a: "Yes — and choose which delivery zones allow it." },
      { q: "How many products can I import?", a: "Thousands — import in one go from a spreadsheet." },
      { q: "Can I test which product page works better?", a: "Yes, with A/B tests in Growth." },
    ],
  },
  {
    slug: "fitness",
    name: "Fitness & wellness",
    noun: "studio or gym",
    icon: Dumbbell,
    tint: "mint",
    photo: "1571019613454-1cb2f99b2d8b",
    alt: "A woman exercising on a mat at home",
    industry: "fitness",
    line: "Class bookings, memberships, online payments",
    title: "Classes booked, members tracked, follow-ups on time.",
    mark: "follow-ups on time",
    lede: "Members book classes online, you keep memberships with visits left and renewal dates in a simple table, and automations follow up after every booking.",
    uses: ["Class bookings", "Website", "Online payments"],
    stack: [
      { label: "Classes", shot: s("bookings", "services", "Services with duration and price") },
      { label: "Booking", shot: s("bookings", "slots", "Choosing a slot") },
      { label: "Memberships", shot: s("data", "rows", "A Memberships table with visits left") },
      { label: "Follow-ups", shot: s("automations", "list", "Automations with triggers and runs") },
      { label: "Your site", shot: s("builder", "mobile", "A site in the phone preview") },
    ],
    shifts: [
      { before: "Class lists on WhatsApp groups", after: "Members book their class online" },
      { before: "Membership cards and a register", after: "A memberships table with visits left" },
      { before: "New members forgotten after their first class", after: "A welcome and a follow-up after every booking" },
    ],
    day: [
      { key: "book", eyebrow: "6:00 · Morning class", title: "Members book their own class.", mark: "book their own class", body: "Each class with its time, length and price; members pick a free slot and pay online or at the studio.", bullets: ["Places per class", "Pay online or at the studio", "Holidays blocked"], tone: "mint", shot: s("bookings", "slots", "Choosing a day and a time"), detail: oldPhone("bookings/phone-slots", "Booking on a phone") },
      { key: "members", eyebrow: "10:00 · The front desk", title: "Memberships in a simple table.", mark: "a simple table", body: "Plans, visits left and renewal dates — your own fields, with a ready-made API if you need it.", bullets: ["Your own fields", "A ready-made API", "Show it on your site"], tone: "sky", shot: s("data", "rows", "A Memberships table with plans, visits left and renewal dates") },
      { key: "renew", eyebrow: "After class · Follow-ups", title: "Follow-ups, sent for you.", mark: "sent for you", body: "A welcome when someone books, a follow-up a few days later, and a ping to your team on Slack.", bullets: ["Email, Slack and webhooks", "Waits and conditions", "Every run logged"], tone: "lavender", shot: s("automations", "list", "Automations with their triggers, steps and runs") },
      { key: "site", eyebrow: "Always · Your website", title: "A site that fills the timetable.", mark: "fills the timetable", body: "Your classes, trainers and prices on a site you edit by clicking — perfect on phones.", bullets: ["Edit in place", "Phone-first", "Your own domain"], tone: "rose", shot: s("builder", "mobile", "A homepage in the builder's phone preview") },
    ],
    toolkit: ["bookings", "data", "automations", "website-builder", "invoicing", "promotions"],
    goodToKnow: ["Memberships live in a data table you shape; visits aren't deducted per booking automatically, and reminders before a plan expires aren't built yet.", "Separate calendars per trainer aren't built yet."],
    faqs: [
      { q: "Can members pay monthly?", a: "Yes — sell monthly plans as subscriptions in the online store." },
      { q: "Can I limit class size?", a: "Yes — set how many people each class slot takes; it stops taking bookings when it's full." },
      { q: "Do members need an app?", a: "No, everything works in their phone's browser." },
    ],
  },
];

export const businessBySlug = (slug: string) => BUSINESSES.find((b) => b.slug === slug);
/** Sign up with this business's industry already picked in onboarding. */
export const signupFor = (b: Business) => `/start?industry=${b.industry}`;
