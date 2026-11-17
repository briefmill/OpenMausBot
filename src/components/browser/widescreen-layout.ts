import { useEffect, useState, type RefObject } from "react";

const PAGE_RATIO = 16 / 9;
export function fitBrowserPage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const fittedWidth = Math.min(width, height * PAGE_RATIO);
  return { width: Math.floor(fittedWidth), height: Math.floor(fittedWidth / PAGE_RATIO) };
}

export function useWidescreenBrowser(panel: RefObject<HTMLDivElement | null>, page: RefObject<HTMLDivElement | null>, fullscreen: boolean, footer?: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<ReturnType<typeof fitBrowserPage>>(null);
  useEffect(() => {
    const card = panel.current, viewport = page.current, parent = card?.parentElement;
    if (fullscreen || !card || !viewport || !parent) { setSize(null); return; }
    const measure = () => {
      const chrome = viewport.getBoundingClientRect().top - card.getBoundingClientRect().top
        + (Number.parseFloat(getComputedStyle(card).borderBottomWidth) || 0);
      const next = fitBrowserPage(card.clientWidth, parent.clientHeight - chrome - (footer?.current?.getBoundingClientRect().height ?? 0));
      setSize(previous => previous?.width === next?.width && previous?.height === next?.height ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (footer?.current) observer.observe(footer.current);
    observer.observe(parent); observer.observe(card); observer.observe(viewport);
    return () => observer.disconnect();
  }, [panel, page, fullscreen, footer]);
  return size;
}
