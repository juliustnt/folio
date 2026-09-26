import { useEffect, useRef, useState } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { revealOffset } from "./readerControls";
import { readingOffsets } from "./readingHighlight";
import type { ReadingHighlight } from "./readingHighlight";
import type { Mark, Point } from "./pdf";
export type Tool = "select" | "text" | "highlight" | "pen";
export function PdfPage({
  pdf,
  page,
  scale,
  thumbnail = false,
  animateRefresh = false,
  continuous = false,
  tool = "select",
  text = "",
  color = "#d4b645",
  size = 16,
  readingHighlight,
  onMark,
  onError,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  thumbnail?: boolean;
  animateRefresh?: boolean;
  continuous?: boolean;
  tool?: Tool;
  text?: string;
  color?: string;
  size?: number;
  readingHighlight?: ReadingHighlight | null;
  onMark?: (mark: Mark) => void;
  onError?: (error: string) => void;
}) {
  const [textVersion, setTextVersion] = useState(0);
  const [readingRects, setReadingRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<PageViewport | null>(null);
  const [dimensions, setDimensions] = useState({
    width: 612 * scale,
    height: 792 * scale,
  });
  const [points, setPoints] = useState<Point[]>([]);
  const drawing = useRef<Point[]>([]);
  const [visible, setVisible] = useState(!thumbnail && !continuous);
  useEffect(() => {
    if ((!thumbnail && !continuous) || !root.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "800px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [thumbnail, continuous]);
  useEffect(() => {
    if (!continuous || visible) return;
    let cancelled = false;
    void pdf.getPage(page).then(p => {
      if (cancelled) return;
      const v = p.getViewport({ scale });
      setDimensions({ width: v.width, height: v.height });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdf, page, scale, continuous, visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let textLayer: TextLayer | undefined;
    const run = async () => {
      const p = await pdf.getPage(page);
      if (cancelled || !canvas.current) return;
      const v = p.getViewport({
        scale: thumbnail ? 116 / p.getViewport({ scale: 1 }).width : scale,
      });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const nextCanvas = document.createElement("canvas");
      nextCanvas.width = Math.floor(v.width * ratio);
      nextCanvas.height = Math.floor(v.height * ratio);
      nextCanvas.style.width = `${v.width}px`;
      nextCanvas.style.height = `${v.height}px`;
      render = p.render({
        canvas: nextCanvas,
        viewport: v,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (cancelled || !canvas.current) return;
      const nextLayer = document.createElement("div");
      if (!thumbnail) {
        textLayer = new TextLayer({
          textContentSource: await p.getTextContent(),
          container: nextLayer,
          viewport: v,
        });
        if (cancelled) return;
        await textLayer.render();
      }
      if (cancelled || !canvas.current) return;
      const previous = canvas.current.firstElementChild;
      canvas.current.replaceChildren(nextCanvas);
      // Keep the completed previous frame above the new page during the fade.
      if (previous && animateRefresh && !thumbnail && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const overlay = previous as HTMLCanvasElement;
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.pointerEvents = "none";
        canvas.current.append(overlay);
        const fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-out" });
        fade.onfinish = () => overlay.remove();
      }
      viewport.current = v;
      setDimensions({ width: v.width, height: v.height });
      if (!thumbnail && layer.current) {
        for (const property of Array.from(nextLayer.style)) {
          layer.current.style.setProperty(property, nextLayer.style.getPropertyValue(property));
        }
        layer.current.setAttribute("data-main-rotation", String(v.rotation));
        layer.current.replaceChildren(...Array.from(nextLayer.childNodes));
        setTextVersion((version) => version + 1);
      }
    };
    run().catch((e) => {
      if (!cancelled && e.name !== "RenderingCancelledException")
        onError?.(e.message);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, scale, thumbnail, visible, onError, animateRefresh]);
  useEffect(() => {
    setReadingRects([]);
    if (thumbnail || !layer.current || !root.current || readingHighlight?.page !== page) return;
    const walker = document.createTreeWalker(layer.current, NodeFilter.SHOW_TEXT);
    const positions: { node: Node; offset: number }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      for (const offset of readingOffsets(node.textContent || "")) positions.push({ node, offset });
    }
    const first = positions[readingHighlight.start];
    const last = positions[readingHighlight.end - 1];
    if (!first || !last) return;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    const scroll = root.current.closest<HTMLElement>(".paper-scroll");
    if (scroll) {
      const passage = range.getBoundingClientRect();
      const visible = scroll.getBoundingClientRect();
      const padding = 24;
      const top = revealOffset(passage.top, passage.bottom, visible.top + padding, visible.top + scroll.clientHeight - padding);
      const left = revealOffset(passage.left, passage.right, visible.left + padding, visible.left + scroll.clientWidth - padding);
      if (top || left) scroll.scrollBy({ top, left, behavior: "instant" });
    }
    const bounds = root.current.getBoundingClientRect();
    setReadingRects(Array.from(range.getClientRects()).filter(rect => rect.width && rect.height).map(rect => ({
      x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height,
    })));
  }, [readingHighlight, page, pdf, scale, thumbnail, textVersion]);
  const locate = (event: React.PointerEvent): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dimensions.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(dimensions.height, event.clientY - rect.top)),
    };
  };
  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    if (thumbnail || tool === "select" || !viewport.current) return;
    if (tool === "text") {
      if (!text.trim()) return;
      const p = locate(event);
      const [x, y] = viewport.current.convertToPdfPoint(p.x, p.y);
      onMark?.({
        type: "text",
        points: [{ x, y }],
        text,
        size,
        color,
        rotation: viewport.current.rotation,
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = [locate(event)];
    setPoints(drawing.current);
  };
  const finish = () => {
    if (!drawing.current.length || !viewport.current) return;
    const path = drawing.current;
    drawing.current = [];
    setPoints([]);
    if (path.length < 2) return;
    const selected =
      tool === "highlight" ? [path[0], path[path.length - 1]] : path;
    const converted = selected.map((p) => {
      const [x, y] = viewport.current!.convertToPdfPoint(p.x, p.y);
      return { x, y };
    });
    onMark?.({
      type: tool === "highlight" ? "highlight" : "pen",
      points: converted,
      size: 2,
      color,
      rotation: viewport.current.rotation,
    });
  };
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div
      ref={root}
      data-page={page}
      className={`pdf-page ${thumbnail ? "thumbnail" : ""} tool-${tool}`}
      style={dimensions}
      onPointerDown={start}
      onPointerMove={(e) => {
        if (drawing.current.length) {
          drawing.current = [...drawing.current, locate(e)];
          setPoints(drawing.current);
        }
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        drawing.current = [];
        setPoints([]);
      }}
    >
      <div ref={canvas} className="page-canvas" />
      {!thumbnail && (
        <div
          ref={layer}
          className="textLayer"
          style={
            {
              ...dimensions,
              "--scale-factor": scale,
              "--total-scale-factor": scale,
            } as React.CSSProperties
          }
        />
      )}
      {!thumbnail && readingHighlight?.page === page && (
        <svg className="reading-highlight" width={dimensions.width} height={dimensions.height} aria-hidden="true">
          {readingRects.map((rect, index) => <rect key={index} {...rect} rx={2} />)}
        </svg>
      )}
      {points.length > 0 && (
        <svg
          className="drawing"
          width={dimensions.width}
          height={dimensions.height}
        >
          {tool === "highlight" ? (
            <rect
              x={Math.min(first.x, last.x)}
              y={Math.min(first.y, last.y)}
              width={Math.abs(first.x - last.x)}
              height={Math.abs(first.y - last.y)}
              fill={color}
              opacity=".3"
            />
          ) : (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2 * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </div>
  );
}
