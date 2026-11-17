import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ChromeRow } from "./ChromeRow";

const props: ComponentProps<typeof ChromeRow> = {
  botName: "Scout", tabs: [], nav: { url: "about:blank", loading: false, canGoBack: false, canGoForward: false },
  connected: false, control: null, takeStatus: "", commandsReady: false, profileName: "Work", maximized: false, menu: null,
  onCommand: vi.fn(), onAddress: vi.fn(), onTake: vi.fn(), onHandBack: vi.fn(), onMaximize: vi.fn(), onProfiles: vi.fn(),
};

afterEach(() => setLocale("en"));

describe("browser window controls", () => {
  it.each([
    ["en", "Maximize (fill the app window)", "Maximize"],
    ["pt-br", "Maximizar (ocupar a janela do app)", "Maximizar"],
  ])("expands within the app window in %s", (locale, hint, label) => {
    setLocale(locale);
    const html = renderToStaticMarkup(createElement(ChromeRow, props));
    expect(html).toContain(`title="${hint}" aria-label="${label}"`);
    expect(html).not.toContain("whole display");
  });
  it.each([["en", "Restore size"], ["pt-br", "Restaurar tamanho"]])("labels restore in %s", (locale, restore) => {
    setLocale(locale);
    const html = renderToStaticMarkup(createElement(ChromeRow, { ...props, maximized: true }));
    expect(html).toContain(`title="${restore}" aria-label="${restore}"`);
  });
});
