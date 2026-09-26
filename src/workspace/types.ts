import type { Tool } from "../PdfPage";
import type { Bookmark } from "../preferences";

export type DocumentSource = { source: string; version: string; latex: boolean };
export type DocumentSnapshot = { bytes: Uint8Array; page: number; bookmarks: Bookmark[] };
export type FitMode = "manual" | "width" | "page";
export type DocumentTab = {
  id: string;
  name: string;
  source: DocumentSource | null;
  latex: boolean;
  documentKey: string;
  bookmarks: Bookmark[];
  bytes: Uint8Array;
  savedBytes: Uint8Array | null;
  page: number;
  zoom: number;
  fitMode: FitMode;
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  tool: Tool;
  query: string;
};

export type Navigation = "pages" | "contents" | "bookmarks";
