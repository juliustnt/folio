import { useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { FitMode } from "../../models/workspace";

export function clampZoom(value: number) {
  return Math.max(0.3, Math.min(3, value));
}

export function usePinchZoom(
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  zoom: number,
  setZoom: Dispatch<SetStateAction<number>>,
  setFitMode: Dispatch<SetStateAction<FitMode>>,
) {
  const currentZoom = useRef(zoom);
  useEffect(() => { currentZoom.current = zoom; }, [zoom]);
  useEffect(() => {
    const element = container.current;
    if (!element || !enabled) return;
    let frame = 0;
    let distance: number | null = null;
    const update = (factor: number) => {
      currentZoom.current = clampZoom(currentZoom.current * factor);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setFitMode("manual");
        setZoom(currentZoom.current);
      });
    };
    // Chromium sends trackpad pinch gestures as Ctrl + wheel events.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      update(Math.exp(-event.deltaY * units * 0.01));
    };
    const separation = (touches: TouchList) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    const start = (event: TouchEvent) => {
      distance = event.touches.length === 2 ? separation(event.touches) : null;
      if (distance !== null) event.preventDefault();
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2) { distance = null; return; }
      event.preventDefault();
      const next = separation(event.touches);
      if (distance && next) update(next / distance);
      distance = next;
    };
    const end = () => { distance = null; };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  }, [container, enabled, setZoom, setFitMode]);
}
