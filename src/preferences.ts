import { useState } from "react";
export const themes = [
  { id: "burgundy", name: "Burgundy" },
  { id: "ocean", name: "Ocean" },
  { id: "forest", name: "Forest" },
  { id: "plum", name: "Plum" },
] as const;
export type Theme = (typeof themes)[number]["id"];

export type Preferences = {
  theme: Theme;
  zoom: number;
  fitPage: boolean;
  fontSize: number;
  voice: string;
  language: string;
  speed: string;
  continuePages: boolean;
  prepareAll: boolean;
  lookahead: number;
  rememberPage: boolean;
  compact: boolean;
  dark: boolean;
};
export const defaults: Preferences = {
  theme: "burgundy",
  zoom: 0.9,
  fitPage: true,
  fontSize: 16,
  voice: "Ryan",
  language: "English",
  speed: "1",
  continuePages: true,
  prepareAll: false,
  lookahead: 2,
  rememberPage: true,
  compact: false,
  dark: false,
};
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => ({
    ...defaults,
    ...readLocal<Partial<Preferences>>("folio.preferences", {}),
  }));
  const update = (patch: Partial<Preferences>) =>
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeLocal("folio.preferences", next);
      return next;
    });
  return [preferences, update] as const;
}
export type Bookmark = { id: string; title: string; page: number };
export function remapBookmarks(
  bookmarks: Bookmark[],
  from: number,
  to?: number,
) {
  return bookmarks
    .filter((b) => to !== undefined || b.page !== from)
    .map((b) => ({
      ...b,
      page:
        to === undefined
          ? b.page > from
            ? b.page - 1
            : b.page
          : b.page === from
            ? to
            : from < to && b.page > from && b.page <= to
              ? b.page - 1
              : from > to && b.page >= to && b.page < from
                ? b.page + 1
                : b.page,
    }));
}
