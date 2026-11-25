import { expect, it } from "vitest";
import { gmailSendAsSignature } from "./signature-provider.ts";

it("requires the exact sending alias rather than the incoming sender or account primary address", () => {
  expect(gmailSendAsSignature("brand@example.com", {sendAsEmail:"other@example.com",signature:"Other business"})).toBeUndefined();
  expect(gmailSendAsSignature("Brand@example.com", {sendAsEmail:"brand@example.com",signature:"Brand"})?.text).toBe("Brand");
});
it("preserves sanitized rich signatures and produces the plain-text alternative", () => {
  const signature = gmailSendAsSignature("me@example.com", {sendAsEmail:"me@example.com",signature:'<div>Alex &amp; Company</div><div>Partnerships<br>me@example.com</div><img src="https://example.com/logo.png" onerror="alert(1)"><script>secret()</script>'});
  expect(signature?.text).toBe("Alex & Company\nPartnerships\nme@example.com");
  expect(signature?.html).toContain('src="https://example.com/logo.png"');
  expect(signature?.html).not.toMatch(/onerror|script|secret/);
});
it("distinguishes an explicitly empty default from unavailable settings", () => {
  expect(gmailSendAsSignature("me@example.com", {sendAsEmail:"me@example.com",signature:""})).toEqual({text:""});
  expect(gmailSendAsSignature("me@example.com", {sendAsEmail:"me@example.com"})).toBeUndefined();
  expect(gmailSendAsSignature("me@example.com", null)).toBeUndefined();
});
it("rejects oversized settings before parsing markup", () => {
  expect(gmailSendAsSignature("me@example.com", {sendAsEmail:"me@example.com",signature:"a".repeat(30_001)})).toBeUndefined();
});
