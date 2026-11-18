import sanitizeHtml from "sanitize-html";
import type { EmailSignature, ReplyContent } from "../../shared/reply-draft.ts";

export function sanitizeSignature(signature: EmailSignature): EmailSignature {
  return {
    text: signature.text,
    ...(signature.html ? {html: sanitizeHtml(signature.html, {
      allowedTags: ["p", "div", "span", "br", "strong", "b", "em", "i", "u", "a", "img", "table", "tbody", "tr", "td"],
      allowedAttributes: {a: ["href", "title"], img: ["src", "alt", "width", "height"], "*": ["style"]},
      allowedSchemes: ["https", "mailto", "tel"],
      allowedSchemesByTag: {img: ["https"]},
      allowProtocolRelative: false,
      allowedStyles: {"*": {
        color: [/^#[a-f0-9]{3,8}$/i],
        "font-size": [/^\d{1,2}px$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "text-decoration": [/^(none|underline)$/],
      }},
    })} : {}),
  };
}

export function sanitizeReplyContent(content: ReplyContent): ReplyContent {
  return content.channel === "email" && content.signature
    ? {...content, signature: sanitizeSignature(content.signature)} : content;
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[character]!);

export function emailReplyBody(content: Extract<ReplyContent, {channel: "email"}>) {
  if (!content.signature) return {text: content.text};
  const signature = sanitizeSignature(content.signature);
  return {
    text: [content.text, signature.text].filter(Boolean).join("\n\n"),
    ...(signature.html ? {html: `<div style="white-space:pre-wrap">${escape(content.text)}</div><br>${signature.html}`} : {}),
  };
}
