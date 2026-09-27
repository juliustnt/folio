import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: [] as (() => void)[] }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) lifecycle.cleanup.push(cleanup);
  },
}));
import { usePinchZoom } from "../src/features/reader/usePinchZoom";

function setup() {
  const element = new EventTarget();
  const frames: (() => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const setZoom = vi.fn();
  const setFitMode = vi.fn();
  usePinchZoom({ current: element as HTMLDivElement }, true, 1, setZoom, setFitMode);
  const dispatch = (type: string, data: object) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, data);
    element.dispatchEvent(event);
    return event;
  };
  return { frames, setZoom, setFitMode, dispatch };
}
afterEach(() => {
  lifecycle.cleanup.splice(0).forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
});
describe("pinch zoom", () => {
  it("leaves ordinary scrolling alone and batches trackpad pinches", () => {
    const { dispatch, frames, setZoom, setFitMode } = setup();
    expect(dispatch("wheel", { ctrlKey: false, deltaY: 20 }).defaultPrevented).toBe(false);
    expect(frames).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      expect(dispatch("wheel", { ctrlKey: true, deltaY: -10, deltaMode: 0 }).defaultPrevented).toBe(true);
    }
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(setZoom.mock.calls[0][0]).toBeCloseTo(Math.exp(0.2));
    expect(setFitMode).toHaveBeenCalledWith("manual");
  });
  it("scales two-finger touches proportionally and stops after release", () => {
    const { dispatch, frames, setZoom } = setup();
    const touches = (distance: number) => [{ clientX: 0, clientY: 0 }, { clientX: distance, clientY: 0 }];
    dispatch("touchstart", { touches: touches(100) });
    dispatch("touchmove", { touches: touches(150) });
    frames.shift()!();
    expect(setZoom).toHaveBeenCalledWith(1.5);
    dispatch("touchend", {});
    dispatch("touchmove", { touches: touches(200) });
    expect(frames).toHaveLength(0);
  });
  it("limits zoom and removes handlers on cleanup", () => {
    const { dispatch, frames, setZoom } = setup();
    dispatch("wheel", { ctrlKey: true, deltaY: -10000, deltaMode: 0 });
    frames.shift()!();
    expect(setZoom).toHaveBeenLastCalledWith(3);
    dispatch("wheel", { ctrlKey: true, deltaY: 10000, deltaMode: 0 });
    frames.shift()!();
    expect(setZoom).toHaveBeenLastCalledWith(0.3);
    lifecycle.cleanup.splice(0).forEach(cleanup => cleanup());
    expect(dispatch("wheel", { ctrlKey: true, deltaY: -10 }).defaultPrevented).toBe(false);
  });
});
