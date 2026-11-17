import type { CdpPage } from "../cdp/page.ts";

export function teachingUrl(raw: string): string {
  try { const url = new URL(raw); return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : url.protocol; }
  catch { return ""; }
}

export class BrowserTeaching {
  active = false;
  #off: Array<() => void> = [];
  #page: CdpPage | null = null;
  #count = 0;
  #since = 0;
  readonly emit: (event: Record<string, unknown>) => void;
  constructor(emit: (event: Record<string, unknown>) => void) { this.emit = emit; }
  start(): void { this.stop(); this.active = true; this.#count = 0; this.#since = Date.now(); this.emit({ kind: "started" }); }
  stop(): void { this.active = false; this.#page = null; for (const off of this.#off.splice(0)) off(); }
  event(event: Record<string, unknown>): void {
    if (!this.active) return;
    if (++this.#count > 4000 || Date.now() - this.#since > 20 * 60_000) {
      this.emit({ kind: "limit", reason: "Recording reached its 20 minute or 4000 event limit." }); this.stop(); return;
    }
    this.emit({ at: Date.now() - this.#since, ...event });
  }
  bind(page: CdpPage): void {
    if (!this.active || page === this.#page) return;
    for (const off of this.#off.splice(0)) off();
    this.#page = page;
    this.event({ kind: "page", url: teachingUrl(page.url()) });
    this.#off.push(page.session.on("Network.requestWillBeSent", (params) => {
      const request = params.request as Record<string, unknown> | undefined;
      if (request) this.event({ kind: "network-request", method: request.method, url: teachingUrl(String(request.url ?? "")), resource: params.type });
    }), page.session.on("Network.responseReceived", (params) => {
      const response = params.response as Record<string, unknown> | undefined;
      if (response) this.event({ kind: "network", url: teachingUrl(String(response.url ?? "")), status: response.status, resource: params.type });
    }), page.session.on("Network.loadingFailed", () => this.event({ kind: "network-failed" })));
  }
  async input(page: CdpPage, message: Record<string, unknown>): Promise<void> {
    if (!this.active) return;
    this.bind(page);
    const type = message.type;
    if (type === "mouse" && message.action !== "down" || type === "key" && message.action === "up") return;
    if (!["mouse", "text", "key", "wheel", "navigate", "history", "reload", "selectChoose", "tabSelect", "tabNew", "tabClose"].includes(String(type))) return;
    const x = Number(message.x), y = Number(message.y);
    const target = await page.evaluate(`(() => {
      const el = ${type === "mouse" && Number.isFinite(x) && Number.isFinite(y) ? `document.elementFromPoint(${x},${y})` : "document.activeElement"};
      if (!(el instanceof Element)) return null;
      const path = []; let node = el;
      while (node && path.length < 8) {
        if (node.id) { path.unshift('#' + CSS.escape(node.id)); break; }
        const parent = node.parentElement;
        path.unshift(node.tagName.toLowerCase() + (parent ? ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')' : ''));
        node = parent;
      }
      return {selector: path.join(' > '), frameContentUnavailable: el.tagName === 'IFRAME', tag: el.tagName.toLowerCase(), id: el.id.slice(0,160), role: el.getAttribute('role'), label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el instanceof HTMLElement && !el.isContentEditable && !['INPUT','TEXTAREA'].includes(el.tagName) ? el.innerText : '') || '').slice(0,160), inputType: el.getAttribute('type')};
    })()`, { world: "isolated", timeoutMs: 1000 }).catch(() => null);
    this.event({ kind: "action", action: type, url: teachingUrl(page.url()), target,
      ...(type === "mouse" ? { x, y, button: message.button } : {}),
      ...(type === "wheel" ? { deltaX: message.deltaX, deltaY: message.deltaY } : {}),
      ...(type === "text" || type === "key" ? { input: "[typed content omitted]", ...(type === "key" && typeof message.key === "string" && message.key.length > 1 ? { key: message.key.slice(0,40) } : {}) } : {}),
      ...(type === "navigate" || type === "tabNew" ? { destination: teachingUrl(String(message.url ?? "")) } : {}),
      ...(type === "selectChoose" ? { index: message.index } : {}) });
  }
}
