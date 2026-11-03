import { describe, expect, it } from "vitest";
import { cardPatchSchema, effective, exchangeSchema, signatureHtml, vcard } from "@/lib/cards/model";
import { phoneDigits, profileSchema, readQuery, suggestUsername, usernameSchema } from "@/lib/people/model";

describe("usernames", () => {
  it("accepts handles people actually type, lowercased and without the @", () => {
    expect(usernameSchema.parse("@Kabir.Shah")).toBe("kabir.shah");
    expect(usernameSchema.parse("meera_iyer2")).toBe("meera_iyer2");
  });
  it("refuses short, oddly shaped and reserved ones", () => {
    for (const bad of ["ab", ".kabir", "kabir.", "kab..ir", "ka bir", "admin", "cloudesk", "x".repeat(31)]) expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
  });
  it("suggests one from a name, then from an email", () => {
    expect(suggestUsername("Kabir Shah", "k@x.in")).toBe("kabir.shah");
    expect(suggestUsername("Zoë Fernández", "")).toBe("zoe.fernandez");
    expect(suggestUsername("", "ravi.k+work@saffron.in")).toBe("ravi.k.work");
    expect(suggestUsername("Al", "")).toBe("aluser");
    expect(suggestUsername("Admin", "")).toBe("admin.cd");
  });
  it("needs a real phone number on a profile", () => {
    expect(profileSchema.safeParse({ phone: "123" }).success).toBe(false);
    expect(profileSchema.safeParse({ phone: "+91 98220 41736" }).success).toBe(true);
    expect(profileSchema.safeParse({ phone: "" }).success).toBe(true);
  });
});

describe("reading a search", () => {
  it("tells an email, a phone number and a username apart", () => {
    expect(readQuery(" Asha@Lumen.Studio ")).toEqual({ kind: "email", value: "asha@lumen.studio" });
    expect(readQuery("+91 98220-41736")).toEqual({ kind: "phone", value: "9822041736" });
    expect(readQuery("098220 41736")).toEqual({ kind: "phone", value: "9822041736" });
    expect(readQuery("@kabir")).toEqual({ kind: "username", value: "kabir" });
    expect(readQuery("Kabir Shah")).toEqual({ kind: "username", value: "kabir shah" });
    expect(readQuery("k")).toEqual({ kind: "none", value: "" });
  });
  it("matches phone numbers on their last ten digits", () => {
    expect(phoneDigits("+91 98220 41736")).toBe(phoneDigits("098220 41736"));
    expect(phoneDigits("12")).toBe("");
  });
});

describe("business IDs", () => {
  const card = { data: { name: "Kabir Shah", title: "Designer", company: "My own co", website: "https://kabir.design", phone: "+91 98220 41736" }, style: { design: "bold", accent: "#2563a8" }, hidden: [] as string[] };
  const company = { data: { company: "Studio North", website: "https://studionorth.in", tagline: "Brands people remember" }, style: { design: "night", accent: "#ff6a55" }, lockStyle: false, lockCompany: true };

  it("uses the company's details when its template fixes them, and fills gaps when it doesn't", () => {
    expect(effective(card, company).data).toMatchObject({ company: "Studio North", website: "https://studionorth.in", tagline: "Brands people remember", name: "Kabir Shah" });
    expect(effective(card, { ...company, lockCompany: false }).data).toMatchObject({ company: "My own co", website: "https://kabir.design", tagline: "Brands people remember" });
  });
  it("keeps the member's design unless the company locks it", () => {
    expect(effective(card, company).style).toMatchObject({ design: "bold", accent: "#2563a8" });
    expect(effective(card, { ...company, lockStyle: true }).style).toMatchObject({ design: "night", accent: "#ff6a55", shape: "portrait" });
    expect(effective({ ...card, style: {} }, null).style).toEqual({ design: "band", accent: "#ff6a55", shape: "portrait" });
  });
  it("leaves hidden fields off the card", () => {
    const e = effective({ ...card, hidden: ["phone", "company"] }, null);
    expect(e.data.phone).toBeUndefined();
    expect(e.data.company).toBeUndefined();
    expect(e.data.name).toBe("Kabir Shah");
  });
  it("cleans up what members type", () => {
    const p = cardPatchSchema.parse({ data: { website: "kabir.design", links: [{ label: "Portfolio", url: "behance.net/kabir" }] }, slug: "Kabir-Shah" });
    expect(p.data?.website).toBe("https://kabir.design");
    expect(p.data?.links?.[0]?.url).toBe("https://behance.net/kabir");
    expect(p.slug).toBe("kabir-shah");
    expect(cardPatchSchema.safeParse({ style: { accent: "red" } }).success).toBe(false);
    expect(cardPatchSchema.safeParse({ slug: "a b" }).success).toBe(false);
  });
  it("needs a way to reach someone who sends their details back, and turns bots away", () => {
    expect(exchangeSchema.safeParse({ name: "Asha" }).success).toBe(false);
    expect(exchangeSchema.safeParse({ name: "Asha", phone: "98220 41736" }).success).toBe(true);
    expect(exchangeSchema.safeParse({ name: "Asha", email: "asha@lumen.studio", website: "spam.example" }).success).toBe(false);
  });
  it("writes a contact file phones understand", () => {
    const v = vcard({ ...card.data, company: "Studio North; Pune", email: "kabir@studionorth.in", bio: "Line one\nLine two" }, "https://cloudesk.in/id/kabir");
    expect(v).toContain("BEGIN:VCARD\r\nVERSION:3.0\r\n");
    expect(v).toContain("N:Shah;Kabir;;;");
    expect(v).toContain("FN:Kabir Shah");
    expect(v).toContain("ORG:Studio North\\; Pune");
    expect(v).toContain("TEL;TYPE=WORK,VOICE:+91 98220 41736");
    expect(v).toContain("EMAIL;TYPE=WORK,INTERNET:kabir@studionorth.in");
    expect(v).toContain("NOTE:Line one\\nLine two\\nBusiness ID: https://cloudesk.in/id/kabir");
    expect(v.trimEnd().endsWith("END:VCARD")).toBe(true);
  });
  it("makes an email signature that's safe to paste", () => {
    const h = signatureHtml({ name: "Kabir <b>Shah</b>", title: "Designer" }, "https://cloudesk.in/id/kabir", "#ff6a55");
    expect(h).toContain("Kabir &lt;b&gt;Shah&lt;/b&gt;");
    expect(h).toContain('href="https://cloudesk.in/id/kabir"');
  });
});
