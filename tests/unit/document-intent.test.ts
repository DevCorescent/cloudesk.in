import { describe, expect, it } from "vitest";
import { wantsDocument } from "@/lib/documents/intent";

// Plain requests for a business document open the studio in the chat at once;
// emails, invoices and questions about documents stay with the copilot.
describe("spotting a request for a document in the chat", () => {
  it("opens the studio for requests to draft one", () => {
    for (const t of ["Draft a mutual NDA with Infosys for 2 years", "make an offer letter for Riya Sen, ₹9 LPA", "I need a legal notice to Sharma Traders for ₹2,40,000", "Prepare a board resolution to open an HDFC account", "write a POSH policy for us", "Create a commercial lease agreement for our Andheri office", "I want a quotation for 200 brass diyas"]) {
      expect(wantsDocument(t), t).toBe(true);
    }
  });
  it("leaves emails, invoices, questions and other asks to the copilot", () => {
    for (const t of ["Reply to Sharma's letter", "Draft an email to Ravi about the order", "Make an invoice for Lumen", "What is an NDA?", "Explain the notice period in my appointment letter", "How did sales do this month?", "Summarise this agreement", "an NDA", "x ".repeat(400) + "draft an nda"]) {
      expect(wantsDocument(t), t).toBe(false);
    }
  });
});
