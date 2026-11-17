import { describe, expect, it } from "vitest";
import { fitBrowserPage } from "./widescreen-layout";

describe("docked browser widescreen layout", () => {
  it("uses panel width rather than filling a tall side panel", () => {
    expect(fitBrowserPage(960, 1600)).toEqual({ width: 960, height: 540 });
    expect(fitBrowserPage(1248, 1600)).toEqual({ width: 1248, height: 702 });
  });
  it("fits short windows without stretching or clipping the page", () => {
    const size = fitBrowserPage(1248, 450)!;
    expect(size).toEqual({ width: 800, height: 450 });
    expect(size.width / size.height).toBeCloseTo(16 / 9);
  });
  it("waits for measurable bounds", () => {
    expect(fitBrowserPage(0, 800)).toBeNull();
    expect(fitBrowserPage(800, NaN)).toBeNull();
  });
});
