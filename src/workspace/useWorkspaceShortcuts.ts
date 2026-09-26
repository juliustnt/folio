import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readerShortcut } from "../readerControls";
import type { FitMode } from "./types";

type ShortcutOptions = {
  pdf: PDFDocumentProxy | null;
  busy: boolean;
  settings: boolean;
  page: number;
  setFitMode: Dispatch<SetStateAction<FitMode>>;
  setZoom: Dispatch<SetStateAction<number>>;
  goToPage: (page: number) => void;
  open: () => void;
  save: () => void;
  history: (redo?: boolean) => void;
};

export function useWorkspaceShortcuts({
  pdf, busy, settings, page, setFitMode, setZoom, goToPage, open, save, history,
}: ShortcutOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = readerShortcut(e);
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        action &&
        !target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]',
        ) &&
        !settings &&
        !document.querySelector('[role="dialog"]')
      ) {
        if (!pdf || busy) return;
        e.preventDefault();
        if (
          action === "zoom-in" ||
          action === "zoom-out" ||
          action === "actual-size"
        ) {
          setFitMode("manual");
          setZoom((current) =>
            action === "actual-size"
              ? 1
              : Math.max(
                  0.3,
                  Math.min(
                    3,
                    Math.round(
                      (current + (action === "zoom-in" ? 0.1 : -0.1)) * 100,
                    ) / 100,
                  ),
                ),
          );
        } else {
          goToPage(
            action === "first-page"
              ? 1
              : action === "last-page"
                ? pdf.numPages
                : Math.max(
                    1,
                    Math.min(
                      pdf.numPages,
                      page + (action === "next-page" ? 1 : -1),
                    ),
                  ),
          );
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (["o", "s", "z"].includes(e.key.toLowerCase())) {
        if (
          (e.target as HTMLElement)?.matches("input,textarea") &&
          e.key.toLowerCase() === "z"
        )
          return;
        e.preventDefault();
        if (e.key.toLowerCase() === "o") open();
        if (e.key.toLowerCase() === "s") save();
        if (e.key.toLowerCase() === "z") history(e.shiftKey);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
}
