import { useEffect, useState, type RefObject } from "react";

const PORTRAIT_MAX_WIDTH = 560;
const SQUARE_MAX_WIDTH = 880;

function browserPageRatio(width: number) {
  if (width < PORTRAIT_MAX_WIDTH) return 9 / 16;
  if (width < SQUARE_MAX_WIDTH) return 1;
  return 16 / 9;
}
export function fitBrowserPage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const ratio = browserPageRatio(width);
  const fittedWidth = Math.min(width, height * ratio);
  return { width: Math.max(1, Math.round(fittedWidth)), height: Math.max(1, Math.round(fittedWidth / ratio)) };
}

export function useWidescreenBrowser(panel: RefObject<HTMLDivElement | null>, page: RefObject<HTMLDivElement | null>, fullscreen: boolean, footer?: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<ReturnType<typeof fitBrowserPage>>(null);
  useEffect(() => {
    const card = panel.current, viewport = page.current, parent = card?.parentElement;
    if (fullscreen || !card || !viewport || !parent) { setSize(null); return; }
    const measure = () => {
      const chrome = viewport.getBoundingClientRect().top - card.getBoundingClientRect().top
        + (Number.parseFloat(getComputedStyle(card).borderBottomWidth) || 0);
      const parentStyle = getComputedStyle(parent);
      const siblings = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== card);
      const occupied = siblings.reduce((height, child) => {
        const style = getComputedStyle(child);
        if (style.position === "absolute" || style.position === "fixed") return height;
        return height + child.getBoundingClientRect().height + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
      }, 0);
      const padding = (Number.parseFloat(parentStyle.paddingTop) || 0) + (Number.parseFloat(parentStyle.paddingBottom) || 0);
      const next = fitBrowserPage(card.clientWidth, parent.clientHeight - padding - occupied - chrome - (footer?.current?.getBoundingClientRect().height ?? 0));
      setSize(previous => previous?.width === next?.width && previous?.height === next?.height ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (footer?.current) observer.observe(footer.current);
    observer.observe(parent); observer.observe(card);
    for (const sibling of parent.children) if (sibling !== card) observer.observe(sibling);
    return () => observer.disconnect();
  }, [panel, page, fullscreen, footer]);
  return size;
}
