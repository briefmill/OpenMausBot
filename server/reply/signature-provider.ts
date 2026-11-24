import sanitizeHtml from "sanitize-html";
import type { EmailSignature } from "../../shared/reply-draft.ts";
import { sanitizeSignature } from "./signature.ts";

/** Gmail send-as settings must come from the authenticated sending account, never an inbound message. */
export function gmailSendAsSignature(from: string, settings: unknown): EmailSignature | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  const alias = settings as Record<string, unknown>;
  if (typeof alias.sendAsEmail !== "string" || alias.sendAsEmail.toLowerCase() !== from.toLowerCase()
    || typeof alias.signature !== "string" || alias.signature.length > 30_000) return undefined;
  const html = sanitizeSignature({ text: "", html: alias.signature }).html ?? "";
  const text = sanitizeHtml(html.replace(/<br\s*\/?\s*>|<\/(?:p|div|tr)>/gi, "\n"), {
    allowedTags: [], allowedAttributes: {},
  }).replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x[0-9a-f]+|#[0-9]+);/gi, entity => {
    const named: Record<string, string> = {"&amp;":"&", "&lt;":"<", "&gt;":">", "&quot;":'"', "&nbsp;":" ", "&#39;":"'"};
    if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()]!;
    const digits = entity.slice(2, -1);
    const point = digits[0]!.toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  })
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!html.trim()) return {text:""};
  return {text, html};
}
