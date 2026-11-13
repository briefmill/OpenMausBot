/** Pinned navigation belongs to one workspace and is shared by its owner's devices.
 * URLs are framed with their own origin; chat pages retain their existing access checks. */

/** Where a bot's page in a chat lives. */
export interface PinnedChatPage {
  botId: string;
  threadId: string;
  messageId: string;
}

export type WebPanel =
  | { id: string; name: string; url: string; page?: undefined }
  | { id: string; name: string; page: PinnedChatPage; url?: undefined };

export const MAX_WEB_PANELS = 6;
export const MAX_WEB_PANEL_NAME = 40;

/** A revision guards concurrent device edits; zero means no device has saved a list yet. */
export interface WebPanelsSnapshot { revision: number; panels: WebPanel[] }

export type WebPanelInput = { name: string; url: string };
export type WebPanelCheck =
  | { ok: true; name: string; url: string }
  | { ok: false; error: "name" | "url" | "self" };

/** A trimmed name of 1–40 characters and an absolute http(s) URL with no
 * user name or password in it, never on `appOrigin`. */
export function validateWebPanel(input: WebPanelInput, appOrigin?: string): WebPanelCheck {
  const name = input.name.trim();
  if (!name || name.length > MAX_WEB_PANEL_NAME) return { ok: false, error: "name" };
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    return { ok: false, error: "url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "url" };
  if (parsed.username || parsed.password || !parsed.hostname) return { ok: false, error: "url" };
  if (appOrigin && isAppOrigin(parsed.href, appOrigin)) return { ok: false, error: "self" };
  return { ok: true, name, url: parsed.href };
}

/** Security: the frame keeps its page's origin (allow-same-origin), so a page on the app's own origin would run with
 * the app's own access. Such a page is never framed. */
export function isAppOrigin(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** The stored list, keeping only entries that still validate, at most six.
 * Never throws: a corrupt value reads as no panels. */
export function parseWebPanels(raw: string | null | undefined): WebPanel[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const panels: WebPanel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (panels.length >= MAX_WEB_PANELS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, url, page } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 200 || seen.has(id) || typeof name !== "string") continue;
    if (page !== undefined) {
      const ref = chatPageRef(page);
      const title = pinnedPageName(name);
      if (!ref || !title) continue;
      seen.add(id);
      panels.push({ id, name: title, page: ref });
      continue;
    }
    if (typeof url !== "string") continue;
    const check = validateWebPanel({ name, url });
    if (!check.ok) continue;
    seen.add(id);
    panels.push({ id, name: check.name, url: check.url });
  }
  return panels;
}

const MAX_REF_ID = 200;

function chatPageRef(value: unknown): PinnedChatPage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { botId, threadId, messageId } = value as Record<string, unknown>;
  const ok = (part: unknown): part is string => typeof part === "string" && part.length > 0 && part.length <= MAX_REF_ID;
  return ok(botId) && ok(threadId) && ok(messageId) ? { botId, threadId, messageId } : undefined;
}

/** A page's title as a panel name: one line, at most 40 characters. */
export function pinnedPageName(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_WEB_PANEL_NAME).trim();
}

/** The panel that pins this chat page, if any. */
export function findPinnedPage(panels: readonly WebPanel[], page: PinnedChatPage): WebPanel | undefined {
  return panels.find((panel) => panel.page?.threadId === page.threadId && panel.page.messageId === page.messageId);
}

/** The list with this chat page pinned (named after its title) or, when it already is, unpinned. Pinning onto a full
 * list changes nothing. */
export function togglePinnedPage(panels: readonly WebPanel[], page: PinnedChatPage, title: string): readonly WebPanel[] {
  const pinned = findPinnedPage(panels, page);
  if (pinned) return panels.filter((panel) => panel !== pinned);
  if (panels.length >= MAX_WEB_PANELS) return panels;
  return [...panels, { id: newWebPanelId(panels), name: pinnedPageName(title) || "Page", page }];
}

export function newWebPanelId(existing: readonly WebPanel[]): string {
  const taken = new Set(existing.map((panel) => panel.id));
  let id: string;
  do { id = `panel-${crypto.randomUUID()}`; } while (taken.has(id));
  return id;
}
