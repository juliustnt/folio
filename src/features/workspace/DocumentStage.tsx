import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize,
  Minus,
  Plus,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import { PdfPage } from "../reader/PdfPage";

type DocumentStageProps = Pick<
  DocumentWorkspace,
  | "pdf"
  | "stage"
  | "tool"
  | "page"
  | "latex"
  | "zoom"
  | "busy"
  | "readingHighlight"
  | "mark"
  | "reportError"
  | "setPage"
  | "goToPage"
  | "setFitMode"
  | "setZoom"
  | "fit"
> & {
  readerIdle: boolean;
  note: string;
  fontSize: number;
  color: string;
};

export function DocumentStage({
  pdf,
  stage,
  tool,
  page,
  latex,
  zoom,
  busy,
  readingHighlight,
  mark,
  reportError,
  setPage,
  goToPage,
  setFitMode,
  setZoom,
  fit,
  readerIdle,
  note,
  fontSize,
  color,
}: DocumentStageProps) {
  return (
    <main
      className={`document-stage${readerIdle ? " reader-idle" : ""}`}
      ref={stage}
    >
      <div className="canvas-heading">
        <span>
          {tool === "select" ? "A LITTLE ROOM TO FOCUS" : "MAKE IT YOURS"}
        </span>
        <span>
          PAGE {String(page).padStart(2, "0")} /{" "}
          {String(pdf?.numPages || 0).padStart(2, "0")}
        </span>
      </div>
      <div className={`paper-scroll${latex ? " continuous-pages" : ""}`}
        onScroll={latex ? (event) => {
          const scroll = event.currentTarget;
          const top = scroll.getBoundingClientRect().top;
          const pages = Array.from(scroll.querySelectorAll<HTMLElement>("[data-page]"));
          const current = pages.find(element => element.getBoundingClientRect().bottom > top + 40);
          if (current) setPage(Number(current.dataset.page));
        } : undefined}>
        {pdf && latex ? (
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i + 1} pdf={pdf} page={i + 1} scale={zoom}
              continuous animateRefresh onError={reportError} />
          ))
        ) : pdf ? (
          <PdfPage
            pdf={pdf}
            page={page}
            scale={zoom}
            tool={busy ? "select" : tool}
            readingHighlight={readingHighlight}
            text={note}
            size={fontSize}
            color={color}
            onMark={mark}
            onError={reportError}
          />
        ) : (
          <div className="loading">
            <BookOpen size={35} />
            <p>Opening your workspace…</p>
          </div>
        )}
      </div>
      <div className="floating-controls">
        <button
          className="icon-button"
          aria-label="Previous page"
          title="Previous page (⌘/Ctrl ←)"
          disabled={page <= 1 || busy}
          onClick={() => goToPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span className="page-position">
          {page} <span>/ {pdf?.numPages || 0}</span>
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          title="Next page (⌘/Ctrl →)"
          disabled={!pdf || page >= pdf.numPages || busy}
          onClick={() => goToPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <span className="separator" />
        <button
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out (⌘/Ctrl −)"
          disabled={zoom <= 0.3}
          onClick={() => {
            setFitMode("manual");
            setZoom(Math.max(0.3, zoom - 0.1));
          }}
        >
          <Minus size={16} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in (⌘/Ctrl +)"
          disabled={zoom >= 3}
          onClick={() => {
            setFitMode("manual");
            setZoom(Math.min(3, zoom + 0.1));
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Fit to width"
          title="Fit to width"
          onClick={fit}
        >
          <Maximize size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Fit whole page"
          title="Fit whole page"
          onClick={() => setFitMode("page")}
        >
          <FileText size={15} />
        </button>
      </div>
    </main>
  );
}
