/**
 * A plain request to draft a business document ("draft an NDA with Infosys",
 * "make an offer letter for Riya"): opened straight in the document studio
 * card, without a round trip to the model. Emails, invoices and questions
 * about a document stay with the copilot.
 */
const DOC_VERB = /\b(draft|create|make|write|prepare|generate|draw up|need|want|give me|i'd like)\b/i;
const DOC_NOUN = /\b(agreement|contract|nda|non[- ]disclosure|mou|memorandum of understanding|letter of intent|loi|deed|lease|leave and licen[cs]e|offer letter|appointment letter|experience letter|relieving letter|warning letter|termination letter|increment letter|promotion letter|salary certificate|show[- ]cause|legal notice|notice|policy|handbook|code of conduct|resolution|minutes|quotation|proposal|business plan|sop|standard operating procedure|rfp|rfq|request for (proposal|quotation)|job description|press release|power of attorney|undertaking|declaration|noc|no objection|certificate|terms (of service|and conditions)|privacy policy|letter)\b/i;
const NOT_DOC = /\b(e-?mail|mail|inbox|reply|whatsapp|message|invoice|bill|receipt|chart|report on|summari[sz]e|explain|what is|what's a|meaning of|difference)\b/i;
export const wantsDocument = (t: string) => t.length <= 600 && DOC_VERB.test(t) && DOC_NOUN.test(t) && !NOT_DOC.test(t);
