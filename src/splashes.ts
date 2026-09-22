import { readLocal, writeLocal } from "./preferences";

const splashes = [
  ["A fresh page.", "A familiar place."],
  ["A place for", "every page."],
  ["A little quiet.", "A good read."],
  ["Room to read.", "Space to think."],
  ["Your next chapter", "starts here."],
  ["Find a thought.", "Leave a mark."],
] as const;

function nextSplash() {
  const stored = readLocal<unknown>("folio.splash", -1);
  const previous = typeof stored === "number" && Number.isInteger(stored)
    && stored >= 0 && stored < splashes.length ? stored : -1;
  const index = (previous + 1) % splashes.length;
  try {
    writeLocal("folio.splash", index);
  } catch {
    // Reading still works when local storage is unavailable.
  }
  return index;
}

// Select once per launch, including React Strict Mode remounts.
const splashIndex = nextSplash();
export const startupSplash = splashes[splashIndex];
export const sidebarSplash = splashes[(splashIndex + 1) % splashes.length];
