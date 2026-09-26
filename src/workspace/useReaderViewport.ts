import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FitMode } from "./types";

type PageNavigationOptions = {
  page: number;
  latex: boolean;
  stage: RefObject<HTMLDivElement | null>;
  setPage: Dispatch<SetStateAction<number>>;
};

export function usePageNavigation({
  page, latex, stage, setPage,
}: PageNavigationOptions) {
  const goToPage = (target: number) => {
    setPage(target);
    if (latex) {
      stage.current
        ?.querySelector<HTMLElement>(`[data-page="${target}"]`)
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  };
  useEffect(() => {
    if (latex) {
      requestAnimationFrame(() => {
        stage.current
          ?.querySelector<HTMLElement>(`[data-page="${page}"]`)
          ?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  }, [latex]);
  return goToPage;
}

type PageFitOptions = Omit<PageNavigationOptions, "setPage"> & {
  pdf: PDFDocumentProxy | null;
  fitMode: FitMode;
  setZoom: Dispatch<SetStateAction<number>>;
};

export function usePageFit({
  pdf, page, latex, stage, fitMode, setZoom,
}: PageFitOptions) {
  useEffect(() => {
    if (!pdf || !stage.current || fitMode === "manual") return;
    let cancelled = false;
    const container = stage.current;
    const update = async () => {
      const viewport = (await pdf.getPage(latex ? 1 : page)).getViewport({ scale: 1 });
      if (cancelled) return;
      const width = (container.clientWidth - 76) / viewport.width;
      const height = (container.clientHeight - 132) / viewport.height;
      setZoom(
        Math.max(
          0.15,
          Math.min(3, fitMode === "page" ? Math.min(width, height) : width),
        ),
      );
    };
    // Keep the previous zoom when a page is unavailable during replacement.
    const keepCurrentZoom = () => {};
    const observer = new ResizeObserver(() => {
      void update().catch(keepCurrentZoom);
    });
    observer.observe(container);
    void update().catch(keepCurrentZoom);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pdf, latex ? 1 : page, fitMode, latex]);
}
