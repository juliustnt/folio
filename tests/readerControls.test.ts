import { describe, expect, it } from "vitest";
import { readerShortcut, revealOffset } from "../src/readerControls";

describe("reader shortcuts", () => {
  const event = { metaKey: true, ctrlKey: false, altKey: false };
  it("supports both plus keyboard forms and page navigation", () => {
    for (const key of ["+", "="]) expect(readerShortcut({ ...event, key })).toBe("zoom-in");
    expect(readerShortcut({ ...event, key: "-" })).toBe("zoom-out");
    expect(readerShortcut({ ...event, key: "0" })).toBe("actual-size");
    for (const [key, action] of [["ArrowRight", "next-page"], ["ArrowLeft", "previous-page"], ["ArrowUp", "first-page"], ["ArrowDown", "last-page"]]) {
      expect(readerShortcut({ ...event, key })).toBe(action);
    }
  });
  it("accepts Ctrl and leaves unrelated or unmodified shortcuts alone", () => {
    expect(readerShortcut({ ...event, metaKey: false, ctrlKey: true, key: "=" })).toBe("zoom-in");
    expect(readerShortcut({ ...event, metaKey: false, key: "ArrowRight" })).toBeNull();
    expect(readerShortcut({ ...event, altKey: true, key: "ArrowRight" })).toBeNull();
    expect(readerShortcut({ ...event, key: "s" })).toBeNull();
  });
});

describe("following the reading highlight", () => {
  it("does not scroll a visible passage", () => expect(revealOffset(30, 80, 20, 100)).toBe(0));
  it("reveals text below or above the viewport", () => {
    expect(revealOffset(90, 130, 20, 100)).toBe(30);
    expect(revealOffset(0, 40, 20, 100)).toBe(-20);
  });
  it("aligns oversized passages at their beginning", () => expect(revealOffset(50, 250, 20, 100)).toBe(30));
});
