# Phase 2: Decompose the document workspace

## Outcome and scope

Phase 2 is complete. `App.tsx` decreased from 1,577 to 406 lines. Thirteen focused modules now hold workspace views, reader hooks, document contracts, and document operations. Phase 1's Listen refactor remains intact. [Phase 3](phase-3-desktop.md), desktop handler/worker/storage organization and remaining workspace JSX extraction, is now complete. The source blocks below remain the historical Phase 2 snapshot.

This follows the Phase 1 plan and the README's local-first, restricted-bridge architecture. The README's Structure section now describes the extracted directories; the Phase 1 plan links to this report. This report is a source snapshot at completion, rather than a second maintained copy of the implementation.

## Analysis before editing

The Phase 1 architectural findings still apply. For Phase 2, three concerns guided the boundaries:

1. PDF loading, tab restoration, history and live reload share one loading-task reference and operation lock. Moving each to an independent owner would risk races or stale state.
2. Reader idle, scrolling, fitting and shortcuts can be read independently but must retain their cancellation, dependencies and cleanup.
3. Large JSX sections obscure document operations. They can move into module-level components without changing their DOM structure or callback behavior.

The corresponding immediate improvements were typed document contracts, isolated reader hooks, and focused workspace views. The document controller stays cohesive to preserve operational sequencing.

## Structure

- `App.tsx`: preferences and presentation state, dialogs, file inputs, and composition.
- `workspace/useDocumentWorkspace.ts`: sole owner of current PDF resources, tabs, edit history, dirty state, persistence, file actions and live-reload coordination.
- `workspace/useReaderIdle.ts`, `useReaderViewport.ts`, `useWorkspaceShortcuts.ts`: reader interaction and layout behavior.
- `workspace/types.ts`, `documentIdentity.ts`: document contracts and content fingerprint.
- Seven view components: header, start screen, tabs, toolbar, navigation rail, document stage and details panel.

Component prop types select only the controller fields each view uses. These are type-only dependencies; the views do not instantiate the document controller.

## Behavior-preservation decisions

- The operation lock and both PDF resource references remain together.
- Snapshot byte references are preserved; dirty detection still compares object identity.
- Undo retains 12 edits. Disposal remains delayed by 100 ms; reload polling remains one second; notices remain four seconds; reader idle remains three seconds.
- Page changes, bookmark remapping and undo/redo retain their original ordering.
- Desktop queue handling and reload polling retain their effect dependencies and latest-callback strategy.
- Error messages and recovery policies are preserved. A text extraction failure still inserts an empty page entry; a fitting failure keeps the prior zoom; unreadable compiler output retains the prior document and reports its existing waiting message.
- Async style changes that could alter timing are deferred. Existing promise chains have not been replaced solely for stylistic consistency.

## Validation

### Automated checks

- Baseline: all 38 existing tests passed and the production build succeeded.
- Final test run: all 38 existing tests plus 16 temporary initial-render comparison cases passed (54 total).
- The comparison rendered original and refactored App trees through React server rendering for all combinations of desktop/browser presence, Explore visibility, dark mode and compact mode. Initial HTML matched exactly. PDF.js was mocked because these cases render only the start screen; effects and native behavior were not exercised by these comparisons.
- The original App copy and temporary comparison test were removed afterward; the permanent test suite remains 38 tests.
- Final production build, strict TypeScript checks and desktop syntax checks passed. `git diff --check` passed.
- Source comparison confirmed unchanged bodies for the operation wrapper, active-tab snapshot, opening, restoring/switching tabs, saving and returning home before type-name-only cleanup.
- Existing large-bundle build warning remains. This phase does not claim bundle-size optimization.

### Browser checks using actual React and PDF.js

Used the local development preview, the built-in sample, a generated single-page fixture, and an intentionally invalid PDF fixture. Observed:

1. Sample loading and page navigation render the expected content.
2. A bookmark on page 2 moves to page 3 when its page moves later; undo restores page 2; redo restores page 3.
3. Opening another PDF preserves the first tab's dirty marker; switching back restores page 3, the bookmark and enabled undo history.
4. The generated one-page PDF disables deletion.
5. Invalid-file opening reports the parse error and leaves the existing PDF selected; dismissing the error clears it.
6. Closing an inactive clean tab leaves the active document in place.
7. An unmatched search reports no matching pages; clearing it restores thumbnails.
8. Fit-to-width, actual-size keyboard zoom and whole-page fitting update the displayed zoom (120%, 100%, and 48% in the test viewport).
9. Save-a-copy clears the dirty indicator. Download delivery itself was not verified: the browser download-event wait timed out.

### Limits and inconclusive checks

- The unsaved-close dialog check timed out in browser automation, and the subsequent dialog lookup returned no dialog. Canceling that prompt was not verified. The confirmation and close logic remain unchanged; no behavior change was made in response to the automation result.
- Native Electron file dialogs, Finder/second-instance opening, actual compiler reload and Qwen playback were not exercised end to end. Existing desktop/source tests still pass.
- Initial-render equality and source comparison do not prove every asynchronous interaction is identical. Browser checks complement them for the document interactions listed above.

## Assumptions and missing context

The existing implementation remains the behavior contract alongside the README. Storage keys, byte identity, snapshots, source access, event exclusions, effect dependencies, messages, error fallbacks and timing are treated as intentional. No new product behavior was inferred from missing context. Browser fixtures contain generated test content only. Native confirmation and file delivery remain validation gaps, not evidence of a newly identified application defect.

## Complete refactored code by chunk

Each block below contains the complete source for its file, with rationale and assumptions. The source files are authoritative for subsequent edits.

### Chunk 1: Shared document contracts

**File:** `src/workspace/types.ts`

**Why:** Names the document source, snapshots, tab state, fitting modes, and navigation sections in one place. Type-only imports avoid runtime coupling to PDF rendering.

**Assumptions:** Byte-array identity continues to indicate unsaved edits; snapshots retain the same byte and bookmark references.

```ts
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
```

### Chunk 2: Document identity

**File:** `src/workspace/documentIdentity.ts`

**Why:** Moves the content fingerprint into a small module so document persistence no longer depends on the application view.

**Assumptions:** The SHA-256 encoding and copy of the input view remain unchanged, preserving existing local-storage keys.

```ts
export async function documentIdentity(data: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
```

### Chunk 3: Reader idle behavior

**File:** `src/workspace/useReaderIdle.ts`

**Why:** Owns input listeners and their timeout cleanup, with a named delay. The component no longer mixes idle controls with document operations.

**Assumptions:** The existing six events, capture/passive options, three-second delay, and initial reveal remain unchanged.

```ts
import { useEffect, useState } from "react";

const READER_IDLE_DELAY_MS = 3000;

export function useReaderIdle() {
  const [readerIdle, setReaderIdle] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const revealControls = () => {
      setReaderIdle(false);
      clearTimeout(timeout);
      timeout = setTimeout(() => setReaderIdle(true), READER_IDLE_DELAY_MS);
    };
    const events = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
      "focusin",
    ] as const;
    for (const event of events)
      window.addEventListener(event, revealControls, {
        capture: true,
        passive: true,
      });
    revealControls();
    return () => {
      clearTimeout(timeout);
      for (const event of events)
        window.removeEventListener(event, revealControls, true);
    };
  }, []);
  return readerIdle;
}
```

### Chunk 4: Page navigation and fitting

**File:** `src/workspace/useReaderViewport.ts`

**Why:** Separates page scrolling and resize fitting into focused hooks while retaining their respective call sites in the document controller. The existing fitting-error fallback is now named and explained.

**Assumptions:** The LaTeX transition effect intentionally depends only on LaTeX mode. Fitting retains the existing dimensions, bounds, dependencies, cancellation guard, and current zoom on failure.

```ts
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
```

### Chunk 5: Workspace keyboard commands

**File:** `src/workspace/useWorkspaceShortcuts.ts`

**Why:** Makes shortcut routing and input/dialog exclusions independently readable. Typed callbacks keep command execution under the document controller.

**Assumptions:** The listener is still registered after every render, as before. Existing shortcut precedence, prevention behavior, zoom bounds, and page clamping are preserved.

```ts
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
```

### Chunk 6: Document ownership and operations

**File:** `src/workspace/useDocumentWorkspace.ts`

**Why:** Keeps the active PDF, loading task, operation lock, tabs, history, persistence, incoming desktop opens, and reload polling under one owner. UI-driven file actions now have names. Named constants expose the existing history limit and lifecycle delays. This is deliberately a cohesive controller: splitting the shared lock and PDF ownership across hooks in this phase would introduce coordination changes.

**Assumptions:** Existing operation order, promise handling, effect dependencies, messages, confirmation policy, source-copy behavior, and reference-based dirty detection remain the contract. Native behavior was not redesigned.

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import type { Tool } from "../PdfPage";
import type { ReadingHighlight } from "../readingHighlight";
import { readLocal, writeLocal } from "../preferences";
import type { Bookmark, Preferences } from "../preferences";
import { extractReadingText } from "../speech";
import { addMark, createWelcome, mergePdf } from "../pdf";
import type { Mark } from "../pdf";
import type { DocumentSource, DocumentSnapshot, FitMode, DocumentTab } from "./types";
import { documentIdentity } from "./documentIdentity";
import { usePageNavigation, usePageFit } from "./useReaderViewport";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";

GlobalWorkerOptions.workerSrc = workerUrl;

const HISTORY_LIMIT = 12;
const PDF_DISPOSAL_DELAY_MS = 100;
const LIVE_RELOAD_INTERVAL_MS = 1000;
const NOTICE_DURATION_MS = 4000;

/** Owns the active PDF, tab snapshots, edit history, and serialized file operations. */
export function useDocumentWorkspace(preferences: Preferences, settings: boolean) {
  const [recents, setRecents] = useState<
    { id: string; name: string; path: string; openedAt: string }[]
  >([]);
  const [documentKey, setDocumentKey] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const refreshRecents = () => {
    window.folio
      ?.recents()
      .then(setRecents)
      .catch((e) => setError(String(e)));
  };
  const [source, setSource] = useState<DocumentSource | null>(null);
  const [tabs, setTabs] = useState<DocumentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [latex, setLatex] = useState(false);
  const [reloadStatus, setReloadStatus] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>(
    preferences.fitPage ? "page" : "manual",
  );
  const [name, setName] = useState("Welcome to Folio.pdf");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(preferences.zoom);
  const [tool, setTool] = useState<Tool>("select");
  const [query, setQuery] = useState("");
  const [readingHighlight, setReadingHighlight] =
    useState<ReadingHighlight | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedBytes, setSavedBytes] = useState<Uint8Array | null>(null);
  const [past, setPast] = useState<DocumentSnapshot[]>([]);
  const [future, setFuture] = useState<DocumentSnapshot[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tabStrip = useRef<HTMLDivElement>(null);
  const goToPage = usePageNavigation({ page, latex, stage, setPage });
  const currentPdf = useRef<PDFDocumentProxy | null>(null);
  const currentLoadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const lock = useRef(false);
  const dirty = bytes !== savedBytes;
  const workspaceDirty =
    dirty ||
    tabs.some(
      (tab) => tab.id !== activeTabId && tab.bytes !== tab.savedBytes,
    );
  const reportError = useCallback((message: string) => setError(message), []);
  const load = async (
    data: Uint8Array,
    targetPage = 1,
    newDocument = false,
  ) => {
    // Validate mutability before showing a file as editable. Encrypted files are not silently decrypted.
    await PDFDocument.load(data);
    const loadingTask = getDocument({ data: data.slice() });
    let loaded: PDFDocumentProxy;
    try {
      loaded = await loadingTask.promise;
    } catch (error) {
      await loadingTask.destroy();
      throw error;
    }
    if (newDocument) {
      const key = await documentIdentity(data);
      const stored = readLocal<{ page: number; bookmarks: Bookmark[] }>(
        "folio.document." + key,
        { page: 1, bookmarks: [] },
      );
      setDocumentKey(key);
      setBookmarks(stored.bookmarks.filter((b) => b.page <= loaded.numPages));
      if (preferences.rememberPage) targetPage = stored.page;
      setZoom(preferences.zoom);
      setFitMode(preferences.fitPage ? "page" : "manual");
    }
    const oldLoadingTask = currentLoadingTask.current;
    currentLoadingTask.current = loadingTask;
    currentPdf.current = loaded;
    setPdf(loaded);
    setBytes(data);
    setPage(Math.max(1, Math.min(targetPage, loaded.numPages)));
    setTexts([]);
    if (oldLoadingTask) setTimeout(() => void oldLoadingTask.destroy(), PDF_DISPOSAL_DELAY_MS);
    const content: string[] = [];
    for (let n = 1; n <= loaded.numPages; n++) {
      if (currentPdf.current !== loaded) break;
      try {
        const data = await (await loaded.getPage(n)).getTextContent();
        content.push(extractReadingText(data.items));
      } catch {
        // Preserve the page index even when this page has no extractable text.
        content.push("");
      }
      if (currentPdf.current === loaded) setTexts([...content]);
    }
  };
  useEffect(() => {
    refreshRecents();
  }, []);
  useEffect(() => {
    if (documentKey && !dirty) {
      try {
        writeLocal("folio.document." + documentKey, { page, bookmarks });
      } catch {
        setError(
          "Unable to save bookmarks or reading position on this device.",
        );
      }
    }
  }, [documentKey, page, bookmarks, dirty]);
  useEffect(() => {
    window.folio?.setDirty(workspaceDirty);
    const handler = (event: BeforeUnloadEvent) => {
      if (workspaceDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [workspaceDirty]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), NOTICE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    tabStrip.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);
  const task = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const activeTab = (): DocumentTab | null =>
    bytes
      ? {
          id: activeTabId,
          name,
          source,
          latex,
          documentKey,
          bookmarks,
          bytes,
          savedBytes,
          page,
          zoom,
          fitMode,
          past,
          future,
          tool,
          query,
        }
      : null;
  const openDocument = async (
    data: Uint8Array,
    filename: string,
    origin: DocumentSource | null = null,
  ) => {
    const previous = activeTab();
    await load(data, 1, true);
    setSource(origin);
    setLatex(origin?.latex ?? false);
    setReloadStatus("");
    setName(filename);
    setSavedBytes(data);
    setPast([]);
    setFuture([]);
    setTool("select");
    setQuery("");
    const id = crypto.randomUUID();
    setTabs((current) => [
      ...current.map((tab) =>
        previous && tab.id === previous.id ? previous : tab,
      ),
      {
        id,
        name: filename,
        source: origin,
        latex: origin?.latex ?? false,
        documentKey: "",
        bookmarks: [],
        bytes: data,
        savedBytes: data,
        page: 1,
        zoom: preferences.zoom,
        fitMode: preferences.fitPage ? "page" : "manual",
        past: [],
        future: [],
        tool: "select",
        query: "",
      },
    ]);
    setActiveTabId(id);
    refreshRecents();
  };
  const restoreTab = async (tab: DocumentTab) => {
    await load(tab.bytes, tab.page);
    setActiveTabId(tab.id);
    setName(tab.name);
    setSource(tab.source);
    setLatex(tab.latex);
    setReloadStatus("");
    setDocumentKey(tab.documentKey);
    setBookmarks(tab.bookmarks);
    setSavedBytes(tab.savedBytes);
    setZoom(tab.zoom);
    setFitMode(tab.fitMode);
    setPast(tab.past);
    setFuture(tab.future);
    setTool(tab.tool);
    setQuery(tab.query);
    setReadingHighlight(null);
  };
  const switchTab = (id: string) => {
    if (id === activeTabId || busy) return;
    const target = tabs.find((tab) => tab.id === id);
    if (!target) return;
    const current = activeTab();
    void task(async () => {
      if (current)
        setTabs((items) =>
          items.map((tab) => (tab.id === current.id ? current : tab)),
        );
      await restoreTab(target);
    });
  };
  const closeTab = (id: string) => {
    if (busy) return;
    const target =
      id === activeTabId ? activeTab() : tabs.find((tab) => tab.id === id);
    if (!target) return;
    if (
      target.bytes !== target.savedBytes &&
      !window.confirm(`Close ${target.name} and discard its unsaved changes?`)
    )
      return;
    if (id !== activeTabId) {
      setTabs((items) => items.filter((tab) => tab.id !== id));
      return;
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs[index + 1] || tabs[index - 1];
    if (!next) {
      setTabs([]);
      clearWorkspace();
      return;
    }
    void task(async () => {
      setTabs((items) => items.filter((tab) => tab.id !== id));
      await restoreTab(next);
    });
  };
  const reloadLatest = useRef<() => Promise<void>>(async () => {});
  reloadLatest.current = async () => {
    if (!latex || !source || !pdf || dirty || lock.current || !window.folio) return;
    lock.current = true;
    try {
      const update = await window.folio.reloadPdf(source.source, source.version);
      if (!update) return;
      setBusy(true);
      const data = new Uint8Array(update.data);
      await load(data, page);
      setSavedBytes(data);
      setPast([]);
      setFuture([]);
      setSource({ ...source, version: update.version });
      setBookmarks((current) =>
        current.filter((bookmark) => bookmark.page <= currentPdf.current!.numPages),
      );
      setReloadStatus("");
    } catch {
      setReloadStatus("Waiting for a readable PDF…");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!latex || !source) return;
    const timer = setInterval(() => void reloadLatest.current(), LIVE_RELOAD_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [latex, source?.source]);
  const [pendingOpen, setPendingOpen] = useState(0);
  const checkingOpen = useRef(false);
  useEffect(
    () => window.folio?.onPendingPdf(() => setPendingOpen((n) => n + 1)),
    [],
  );
  useEffect(() => {
    if (!window.folio || busy || checkingOpen.current) return;
    checkingOpen.current = true;
    void window.folio
      .nextPdf()
      .then(async (file) => {
        if (file) {
          const existing = tabs.find((tab) => tab.source?.source === file.source);
          if (source?.source === file.source) {
            if (file.latex) setLatex(true);
          } else if (existing) {
            switchTab(existing.id);
          } else {
            await task(() =>
              openDocument(new Uint8Array(file.data), file.name, file),
            );
          }
          setPendingOpen((n) => n + 1);
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPendingOpen((n) => n + 1);
      })
      .finally(() => {
        checkingOpen.current = false;
      });
  }, [busy, pendingOpen]);
  const open = () => {
    if (window.folio)
      void task(async () => {
        const file = await window.folio!.openPdf();
        if (file)
          await openDocument(new Uint8Array(file.data), file.name, file);
      });
    else input.current?.click();
  };
  const edit = (
    fn: (data: Uint8Array) => Promise<Uint8Array>,
    target = page,
    nextBookmarks = bookmarks,
  ) => {
    if (!bytes) return;
    void task(async () => {
      const next = await fn(bytes);
      await load(next, target);
      setBookmarks(nextBookmarks);
      setPast((history) => [...history.slice(-(HISTORY_LIMIT - 1)), { bytes, page, bookmarks }]);
      setFuture([]);
    });
  };
  const history = (redo = false) => {
    const stack = redo ? future : past;
    const snapshot = stack.at(-1);
    if (!snapshot || !bytes) return;
    void task(async () => {
      await load(snapshot.bytes, snapshot.page);
      setBookmarks(snapshot.bookmarks);
      const current = { bytes, page, bookmarks };
      if (redo) {
        setFuture(stack.slice(0, -1));
        setPast([...past, current]);
      } else {
        setPast(stack.slice(0, -1));
        setFuture([...future, current]);
      }
    });
  };
  const save = () => {
    if (!bytes) return;
    void task(async () => {
      if (window.folio) {
        if (
          !(await window.folio.savePdf(
            name.replace(/\.pdf$/i, "") + "-edited.pdf",
            bytes,
          ))
        )
          return;
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = name.replace(/\.pdf$/i, "") + "-edited.pdf";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDocumentKey(await documentIdentity(bytes));
      setSavedBytes(bytes);
      refreshRecents();
      setNotice("Your PDF copy is saved.");
    });
  };
  useWorkspaceShortcuts({
    pdf, busy, settings, page, setFitMode, setZoom, goToPage, open, save, history,
  });
  const merge = () => {
    if (window.folio)
      void task(async () => {
        const file = await window.folio!.openPdf();
        if (file && bytes) {
          const next = await mergePdf(bytes, new Uint8Array(file.data));
          await load(next, page);
          setPast([...past.slice(-(HISTORY_LIMIT - 1)), { bytes, page, bookmarks }]);
          setFuture([]);
          setNotice("Pages added to your document.");
        }
      });
    else mergeInput.current?.click();
  };
  const mark = (value: Mark) => edit((data) => addMark(data, page - 1, value));
  const fit = () => setFitMode("width");
  usePageFit({ pdf, page, latex, stage, fitMode, setZoom });

  const clearWorkspace = () => {
    setDocumentKey("");
    setBookmarks([]);
    setSource(null);
    setLatex(false);
    setPdf(null);
    setBytes(null);
    setSavedBytes(null);
    setTexts([]);
    setPast([]);
    setFuture([]);
    setActiveTabId("");
    const previousLoadingTask = currentLoadingTask.current;
    currentLoadingTask.current = null;
    currentPdf.current = null;
    setTimeout(() => void previousLoadingTask?.destroy(), PDF_DISPOSAL_DELAY_MS);
    refreshRecents();
  };
  const goHome = () => {
    if (
      workspaceDirty &&
      !window.confirm("Return to Start and discard unsaved PDF changes?")
    )
      return;
    setTabs([]);
    clearWorkspace();
  };
  const explore = () =>
    void task(async () =>
      openDocument(await createWelcome(), "Welcome to Folio.pdf"),
    );
  const openRecent = (id: string) =>
    void task(async () => {
      const file = await window.folio!.openRecent(id);
      await openDocument(new Uint8Array(file.data), file.name, file);
    });
  const removeRecent = async (id: string) => {
    try {
      await window.folio!.removeRecent(id);
      setRecents((items) => items.filter((item) => item.id !== id));
    } catch (e) {
      setError(String(e));
    }
  };
  const openBrowserFile = (file: File) =>
    void task(async () =>
      openDocument(new Uint8Array(await file.arrayBuffer()), file.name),
    );
  const mergeBrowserFile = (file: File) =>
    edit(async (data) => mergePdf(data, new Uint8Array(await file.arrayBuffer())));

  return {
    recents,
    source,
    tabs,
    activeTabId,
    latex,
    setLatex,
    reloadStatus,
    setReloadStatus,
    pdf,
    bytes,
    fitMode,
    setFitMode,
    name,
    page,
    setPage,
    zoom,
    setZoom,
    tool,
    setTool,
    query,
    setQuery,
    readingHighlight,
    setReadingHighlight,
    texts,
    busy,
    error,
    setError,
    notice,
    bookmarks,
    setBookmarks,
    dirty,
    past,
    future,
    input,
    mergeInput,
    stage,
    tabStrip,
    goToPage,
    reportError,
    switchTab,
    closeTab,
    open,
    edit,
    history,
    save,
    merge,
    mark,
    fit,
    goHome,
    explore,
    openRecent,
    removeRecent,
    openBrowserFile,
    mergeBrowserFile,
  };
}

export type DocumentWorkspace = ReturnType<typeof useDocumentWorkspace>;
```

### Chunk 7: Workspace header

**File:** `src/workspace/WorkspaceHeader.tsx`

**Why:** Separates common document commands from the application composition. It receives only the commands and state it needs. Removes an already-commented-out badge, with no rendered change.

**Assumptions:** Button text, disabled conditions, labels and command callbacks retain their existing behavior.

```tsx
import {
  FolderOpen,
  Download,
  Home,
  Settings2,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";

type WorkspaceHeaderProps = Pick<
  DocumentWorkspace,
  | "busy"
  | "bytes"
  | "goHome"
  | "open"
  | "save"
> & {
  onSettings: () => void;
};

export function WorkspaceHeader({
  busy,
  bytes,
  goHome,
  open,
  save,
  onSettings,
}: WorkspaceHeaderProps) {
  return (
    <header className="titlebar">
      <div className="brand">
        <span>
          folio<span className="brand-dot">.</span>
        </span>
        <span className="brand-divider" />
        <span className="workspace-label">Your document workspace</span>
      </div>
      <div className="title-actions">
        <button
          aria-label="Start"
          title="Start"
          onClick={goHome}
          disabled={busy}
        >
          <Home size={17} />
        </button>
        <button
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
        >
          <Settings2 size={17} />
        </button>
        <button onClick={open} disabled={busy}>
          <FolderOpen size={15} /> Open PDF <kbd>⌘O</kbd>
        </button>
        <button className="primary" onClick={save} disabled={!bytes || busy}>
          <Download size={15} /> Save a copy
        </button>
      </div>
    </header>
  );
}
```

### Chunk 8: Start screen

**File:** `src/workspace/StartScreen.tsx`

**Why:** Separates welcome/recent-file presentation from the controller actions that open and remove recent entries.

**Assumptions:** Optional Explore visibility, local recent-path display, loading/error messages and callback ordering remain unchanged.

```tsx
import {
  BookOpen,
  ChevronRight,
  FileText,
  FolderOpen,
  X,
  Settings2,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import { startupSplash } from "../splashes";

type StartScreenProps = Pick<
  DocumentWorkspace,
  | "busy"
  | "recents"
  | "error"
  | "open"
  | "explore"
  | "openRecent"
  | "removeRecent"
> & {
  showExplore: boolean;
  onSettings: () => void;
};

export function StartScreen({
  busy,
  recents,
  error,
  open,
  explore,
  openRecent,
  removeRecent,
  showExplore,
  onSettings,
}: StartScreenProps) {
  return (
    <main className="start-screen">
      <div className="start-intro">
        <h1>
          {startupSplash[0]}
          <br />
          {startupSplash[1]}
        </h1>
        <p>Read, mark up, and listen.</p>
      </div>
      <div className="start-columns">
        <section>
          <h2>Start</h2>
          <button className="start-action" onClick={open} disabled={busy}>
            <FolderOpen size={21} />
            <span>
              Open a PDF<small>Pick up wherever your ideas take you.</small>
            </span>
            <kbd>⌘O</kbd>
          </button>
          {showExplore && (
            <button
              className="start-action"
              disabled={busy}
              onClick={explore}
            >
              <BookOpen size={21} />
              <span>
                Explore Folio
                <small>Open the sample document and try the tools.</small>
              </span>
            </button>
          )}
          <button
            className="start-action"
            onClick={onSettings}
          >
            <Settings2 size={21} />
            <span>
              Settings
              <small>Your reading, voice, and workspace preferences.</small>
            </span>
          </button>
        </section>
        <section>
          <h2>Recent documents</h2>
          {recents.length ? (
            recents.map((recent) => (
              <div className="recent-file" key={recent.id}>
                <button
                  className="recent-open"
                  disabled={busy}
                  onClick={() => openRecent(recent.id)}
                >
                  <FileText size={18} />
                  <span>
                    {recent.name}
                    <small title={recent.path}>{recent.path}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
                <button
                  className="recent-remove"
                  disabled={busy}
                  title="Remove from recents"
                  aria-label={`Remove ${recent.name} from recents`}
                  onClick={() => removeRecent(recent.id)}
                >
                  <X size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-recents">
              <FileText size={28} />
              <small>
                <br></br>PDFs you open will appear in this list.
              </small>
            </div>
          )}
        </section>
      </div>
      {busy && <p role="status">Opening document…</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
```

### Chunk 9: Document tabs

**File:** `src/workspace/DocumentTabs.tsx`

**Why:** Makes tab selection, closing and dirty indicators a focused view. The existing tab-strip ref remains owned by the controller.

**Assumptions:** Selected-tab names and dirtiness still come from active state; inactive tabs use their stored snapshots.

```tsx
import {
  Check,
  FileText,
  Plus,
  X,
  BookmarkPlus,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";

type DocumentTabsProps = Pick<
  DocumentWorkspace,
  | "tabs"
  | "activeTabId"
  | "dirty"
  | "name"
  | "busy"
  | "tabStrip"
  | "switchTab"
  | "closeTab"
  | "open"
> & {
  addBookmark: () => void;
};

export function DocumentTabs({
  tabs,
  activeTabId,
  dirty,
  name,
  busy,
  tabStrip,
  switchTab,
  closeTab,
  open,
  addBookmark,
}: DocumentTabsProps) {
  return (
    <div className="document-bar">
      <div
        className="document-tabs"
        role="tablist"
        aria-label="Open PDFs"
        ref={tabStrip}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          const tabDirty = selected ? dirty : tab.bytes !== tab.savedBytes;
          return (
            <div
              className={`document-tab${selected ? " active" : ""}`}
              key={tab.id}
            >
              <button
                role="tab"
                aria-selected={selected}
                title={tab.name}
                disabled={busy}
                onClick={() => switchTab(tab.id)}
              >
                <FileText size={15} />
                <span>{selected ? name : tab.name}</span>
                {tabDirty && (
                  <span className="unsaved-dot" title="Unsaved changes" />
                )}
              </button>
              <button
                className="tab-close"
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
                disabled={busy}
                onClick={() => closeTab(tab.id)}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button
          className="new-tab"
          aria-label="Open another PDF"
          title="Open another PDF"
          disabled={busy}
          onClick={open}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="document-bar-actions">
        <button className="text-button" onClick={addBookmark}>
          <BookmarkPlus size={15} /> Bookmark page
        </button>
        <span className="document-state">
          {busy ? (
            "Working…"
          ) : dirty ? (
            "Unsaved changes"
          ) : (
            <>
              <Check size={12} /> All set
            </>
          )}
        </span>
      </div>
    </div>
  );
}
```

### Chunk 10: Editing toolbar

**File:** `src/workspace/WorkspaceToolbar.tsx`

**Why:** Groups tool selection, history buttons, panel controls and annotation options into one view.

**Assumptions:** Existing tool colors, panel toggles, shortcut labels, option order, hidden conditions and disabled conditions are retained.

```tsx
import {
  Check,
  Headphones,
  Highlighter,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Redo2,
  Type,
  Undo2,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import type { Preferences } from "../preferences";
import type { Tool } from "../PdfPage";

type WorkspaceToolbarProps = Pick<
  DocumentWorkspace,
  | "busy"
  | "latex"
  | "tool"
  | "setTool"
  | "past"
  | "future"
  | "history"
> & {
  rail: boolean;
  setRail: (visible: boolean) => void;
  panel: Preferences["panel"];
  setPanel: (panel: Preferences["panel"]) => void;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
  note: string;
  setNote: (note: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  color: string;
  setColor: (color: string) => void;
};

export function WorkspaceToolbar({
  busy,
  latex,
  tool,
  setTool,
  past,
  future,
  history,
  rail,
  setRail,
  panel,
  setPanel,
  preferences,
  updatePreferences,
  note,
  setNote,
  fontSize,
  setFontSize,
  color,
  setColor,
}: WorkspaceToolbarProps) {
  const tools: { id: Tool; label: string; icon: typeof MousePointer2 }[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "highlight", label: "Highlight", icon: Highlighter },
    { id: "text", label: "Add text", icon: Type },
    { id: "pen", label: "Draw", icon: PenLine },
  ];
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            className="icon-button"
            title={rail ? "Hide left sidebar" : "Show left sidebar"}
            aria-label={rail ? "Hide left sidebar" : "Show left sidebar"}
            aria-expanded={rail}
            aria-controls="left-sidebar"
            onClick={() => setRail(!rail)}
          >
            {rail ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <span className="separator" />
          {!latex && tools.map(({ id, label, icon: Icon }) => (
            <button
              disabled={busy}
              key={id}
              aria-label={label}
              title={label}
              className={tool === id ? "active" : ""}
              onClick={() => {
                setTool(id);
                if (id === "highlight") setColor("#c5a634");
                else if (id !== "select") setColor("#254f41");
              }}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <button
            className="icon-button"
            title="Undo (⌘Z)"
            aria-label="Undo"
            disabled={!past.length || busy}
            onClick={() => history()}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            disabled={!future.length || busy}
            onClick={() => history(true)}
          >
            <Redo2 size={17} />
          </button>
          <span className="separator" />
          <button
            aria-label="Listen"
            className={panel === "listen" ? "active" : ""}
            aria-pressed={panel === "listen"}
            onClick={() =>
              setPanel(
                panel === "listen" && preferences.sidebarVisible
                  ? "details"
                  : "listen",
              )
            }
          >
            <Headphones size={16} />
            <span>Listen</span>
          </button>
          <button
            className="icon-button"
            title={
              preferences.sidebarVisible
                ? "Hide right sidebar"
                : "Show right sidebar"
            }
            aria-label={
              preferences.sidebarVisible
                ? "Hide right sidebar"
                : "Show right sidebar"
            }
            aria-expanded={preferences.sidebarVisible}
            aria-controls="right-sidebar"
            onClick={() =>
              updatePreferences({ sidebarVisible: !preferences.sidebarVisible })
            }
          >
            {preferences.sidebarVisible ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </button>
        </div>
      </div>
      {!latex && tool !== "select" && (
        <div className="tool-options">
          <span>
            {tool === "text"
              ? "Type your note, then click to place it."
              : tool === "highlight"
                ? "Drag to highlight an area."
                : "Draw directly on the page."}
          </span>
          {tool === "text" && (
            <>
              <input
                aria-label="Text to add"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write something…"
              />
              <select
                aria-label="Text size"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              >
                {[10, 12, 16, 20, 24, 32].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
    </>
              )}
              <input
                type="color"
                aria-label="Annotation color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <button
                className="icon-button"
                onClick={() => setTool("select")}
                aria-label="Finish annotating"
              >
                <Check size={15} />
              </button>
            </div>
          )}

    </>
  );
}
```

### Chunk 11: Document navigation

**File:** `src/workspace/NavigationRail.tsx`

**Why:** Separates contents, bookmarks, thumbnails and search presentation from document ownership.

**Assumptions:** Contents/bookmark/thumbnail navigation still calls the existing page setter. Search snippets and partially extracted text retain their original behavior.

```tsx
import {
  FilePlus2,
  PenLine,
  Plus,
  Search,
  X,
  Layers,
  BookmarkPlus,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import { PdfPage } from "../PdfPage";
import Contents from "../Contents";
import type { Bookmark } from "../preferences";
import type { Navigation } from "./types";

type NavigationRailProps = Pick<
  DocumentWorkspace,
  | "pdf"
  | "bookmarks"
  | "setBookmarks"
  | "query"
  | "setQuery"
  | "texts"
  | "page"
  | "setPage"
  | "busy"
  | "merge"
> & {
  navigation: Navigation;
  setNavigation: (navigation: Navigation) => void;
  addBookmark: () => void;
  renameBookmark: (bookmark: Bookmark) => void;
};

export function NavigationRail({
  pdf,
  bookmarks,
  setBookmarks,
  query,
  setQuery,
  texts,
  page,
  setPage,
  busy,
  merge,
  navigation,
  setNavigation,
  addBookmark,
  renameBookmark,
}: NavigationRailProps) {
  return (
    <aside id="left-sidebar" className="page-rail">
      <div className="panel-heading">
        <span>
          <Layers size={15} /> Navigate
        </span>
        <span className="page-count">{pdf?.numPages || 0}</span>
      </div>
      <div className="navigation-tabs">
        <button
          className={navigation === "pages" ? "active" : ""}
          onClick={() => setNavigation("pages")}
        >
          Pages
        </button>
        <button
          className={navigation === "contents" ? "active" : ""}
          onClick={() => setNavigation("contents")}
        >
          Contents
        </button>
        <button
          aria-label="Bookmarks"
          className={navigation === "bookmarks" ? "active" : ""}
          onClick={() => setNavigation("bookmarks")}
        >
          <BookmarkIcon size={14} />
        </button>
      </div>
      {navigation === "contents" && pdf ? (
        <Contents pdf={pdf} go={setPage} />
      ) : navigation === "bookmarks" ? (
        <div className="navigation-list">
          <button onClick={addBookmark}>
            <BookmarkPlus size={14} /> Add bookmark
          </button>
          {!bookmarks.length && (
            <p>
              Keep a place worth coming back to. Bookmarks are saved
              locally for this PDF.
            </p>
          )}
          {bookmarks.map((bookmark) => (
            <div className="bookmark-row" key={bookmark.id}>
              <button onClick={() => setPage(bookmark.page)}>
                <span>{bookmark.title}</span>
                <small>{bookmark.page}</small>
              </button>
              <button
                title="Rename bookmark"
                aria-label={`Rename ${bookmark.title}`}
                onClick={() => renameBookmark(bookmark)}
              >
                <PenLine size={12} />
              </button>
              <button
                title="Remove bookmark"
                aria-label={`Remove ${bookmark.title}`}
                onClick={() =>
                  setBookmarks(
                    bookmarks.filter((b) => b.id !== bookmark.id),
                  )
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="search-box">
            <Search size={14} />
            <input
              aria-label="Search document"
              placeholder="Find in document"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="page-list">
            {pdf &&
              Array.from({ length: pdf.numPages }, (_, i) => i + 1)
                .filter(
                  (n) =>
                    !query ||
                    texts[n - 1]
                      ?.toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((n) => (
                  <button
                    key={`${pdf.fingerprints[0]}-${n}`}
                    className={`page-item ${page === n ? "selected" : ""}`}
                    onClick={() => setPage(n)}
                    aria-label={`Go to page ${n}`}
                  >
                    <div className="thumb-frame">
                      <PdfPage
                        pdf={pdf}
                        page={n}
                        scale={0.19}
                        thumbnail
                      />
                    </div>
                    <span className="page-caption">
                      <span>{String(n).padStart(2, "0")}</span>
                      {n === page && <span className="current-dot" />}
                    </span>
                    {query && (
                      <span className="search-snippet">
                        {texts[n - 1]?.slice(
                          Math.max(
                            0,
                            texts[n - 1]
                              .toLowerCase()
                              .indexOf(query.toLowerCase()) - 24,
                          ),
                          texts[n - 1]
                            .toLowerCase()
                            .indexOf(query.toLowerCase()) + 65,
                        )}
                      </span>
                    )}
                  </button>
                ))}
            {query &&
              !texts.some((t) =>
                t.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className="empty-search">
                  {texts.length < (pdf?.numPages || 0)
                    ? "Searching…"
                    : "No matching pages."}
                </p>
              )}
          </div>
        </>
      )}
      <button className="merge-button" disabled={busy} onClick={merge}>
        <FilePlus2 size={15} /> Merge PDF <Plus size={13} />
      </button>
    </aside>
  );
}
```

### Chunk 12: Document stage

**File:** `src/workspace/DocumentStage.tsx`

**Why:** Groups page rendering and floating reader controls while keeping PDF ownership outside the view. No extra DOM wrapper was introduced.

**Assumptions:** Single-page and continuous LaTeX rendering preserve their branches, keys, callbacks, shared stage ref, scrolling and annotation props.

```tsx
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
import { PdfPage } from "../PdfPage";

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
```

### Chunk 13: Document details and organization

**File:** `src/workspace/DetailsPanel.tsx`

**Why:** Isolates file information and page operations. Existing PDF transformation functions and bookmark remapping remain the implementation.

**Assumptions:** Rotation, reordering, deletion and last-page protection retain the same page indices, targets, bookmark mappings and disabled conditions.

```tsx
import {
  ArrowDown,
  ArrowUp,
  FileText,
  RotateCw,
  Trash2,
} from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import type { ReactNode } from "react";
import { sidebarSplash } from "../splashes";
import { rotatePage, movePage, deletePage } from "../pdf";
import { remapBookmarks } from "../preferences";

type DetailsPanelProps = Pick<
  DocumentWorkspace,
  | "pdf"
  | "bytes"
  | "page"
  | "latex"
  | "busy"
  | "bookmarks"
  | "edit"
> & {
  latexControls: ReactNode;
  hidden: boolean;
};

export function DetailsPanel({
  pdf,
  bytes,
  page,
  latex,
  busy,
  bookmarks,
  edit,
  latexControls,
  hidden,
}: DetailsPanelProps) {
  return (
    <aside
      id="right-sidebar"
      className="details-panel"
      hidden={hidden}
    >
      <div className="panel-heading">
        <span>
          <FileText size={16} /> Document
        </span>
      </div>
      {latexControls}
      <h2>
        {sidebarSplash[0]}
        <br />
        {sidebarSplash[1]}
      </h2>
      <div className="document-info">
        <span>Current page</span>
        <strong>
          {page} of {pdf?.numPages}
        </strong>
        <span>File size</span>
        <strong>{((bytes?.length || 0) / 1024).toFixed(1)} KB</strong>
      </div>
      <div className="page-actions" hidden={latex}>
        <button
          onClick={() => edit((data) => rotatePage(data, page - 1))}
          disabled={busy}
        >
          <RotateCw size={16} /> Rotate clockwise
        </button>
        <button
          onClick={() =>
            edit(
              (data) => movePage(data, page - 1, -1),
              page - 1,
              remapBookmarks(bookmarks, page, page - 1),
            )
          }
          disabled={busy || page === 1}
        >
          <ArrowUp size={16} /> Move page earlier
        </button>
        <button
          onClick={() =>
            edit(
              (data) => movePage(data, page - 1, 1),
              page + 1,
              remapBookmarks(bookmarks, page, page + 1),
            )
          }
          disabled={busy || page === pdf?.numPages}
        >
          <ArrowDown size={16} /> Move page later
        </button>
        <button
          className="danger"
          onClick={() =>
            edit(
              (data) => deletePage(data, page - 1),
              page,
              remapBookmarks(bookmarks, page),
            )
          }
          disabled={busy || (pdf?.numPages || 0) <= 1}
        >
          <Trash2 size={16} /> Delete this page
        </button>
      </div>
    </aside>
  );
}
```

### Chunk 14: Application composition

**File:** `src/App.tsx`

**Why:** Reduces App from 1,577 to 406 lines. It now composes workspace views, settings, Listen, the bookmark dialog, notices, and browser file inputs. Presentation-only state stays here; document operations are delegated to the controller.

**Assumptions:** Components are defined at module scope to keep their identity stable across renders. No memoization or new reset policy was introduced. The existing application-level preference and bookmark editing flows are preserved.

```tsx
import { useEffect, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import Listen from "./Listen";
import Settings from "./Settings";
import { usePreferences } from "./preferences";
import type { Bookmark } from "./preferences";
import type { Navigation } from "./workspace/types";
import { useDocumentWorkspace } from "./workspace/useDocumentWorkspace";
import { useReaderIdle } from "./workspace/useReaderIdle";
import { WorkspaceHeader } from "./workspace/WorkspaceHeader";
import { StartScreen } from "./workspace/StartScreen";
import { DocumentTabs } from "./workspace/DocumentTabs";
import { WorkspaceToolbar } from "./workspace/WorkspaceToolbar";
import { NavigationRail } from "./workspace/NavigationRail";
import { DocumentStage } from "./workspace/DocumentStage";
import { DetailsPanel } from "./workspace/DetailsPanel";

export default function App() {
  const [preferences, updatePreferences] = usePreferences();
  const [settings, setSettings] = useState(false);
  const [navigation, setNavigation] = useState<Navigation>("pages");
  const [bookmarkDraft, setBookmarkDraft] = useState<{
    id?: string;
    title: string;
    page: number;
  } | null>(null);
  const panel = preferences.panel;
  const setPanel = (panel: "listen" | "details") =>
    updatePreferences({ panel, sidebarVisible: true });
  const rail = preferences.navigationVisible;
  const setRail = (navigationVisible: boolean) =>
    updatePreferences({ navigationVisible });
  const [note, setNote] = useState("");
  const [color, setColor] = useState("#c5a634");
  const [fontSize, setFontSize] = useState(preferences.fontSize);
  useEffect(() => {
    setFontSize(preferences.fontSize);
  }, [preferences.fontSize]);
  const readerIdle = useReaderIdle();
  const {
    recents,
    source,
    tabs,
    activeTabId,
    latex,
    setLatex,
    reloadStatus,
    setReloadStatus,
    pdf,
    bytes,
    setFitMode,
    name,
    page,
    setPage,
    zoom,
    setZoom,
    tool,
    setTool,
    query,
    setQuery,
    readingHighlight,
    setReadingHighlight,
    texts,
    busy,
    error,
    setError,
    notice,
    bookmarks,
    setBookmarks,
    dirty,
    past,
    future,
    input,
    mergeInput,
    stage,
    tabStrip,
    goToPage,
    reportError,
    switchTab,
    closeTab,
    open,
    edit,
    history,
    save,
    merge,
    mark,
    fit,
    goHome,
    explore,
    openRecent,
    removeRecent,
    openBrowserFile,
    mergeBrowserFile,
  } = useDocumentWorkspace(preferences, settings);
  const latexControls = source && preferences.showLatex ? (
    <div className="latex-controls">
      {source && (
        <button
          className="text-button"
          aria-pressed={latex}
          title="Reload compiler output automatically; pauses while you have unsaved edits"
          onClick={() => {
            setLatex(!latex);
            setReloadStatus("");
          }}
        >
          LaTeX {latex ? "on" : "off"}
        </button>
      )}
      {latex && (
        <span role="status">
          {dirty
            ? "Reload paused · unsaved edits"
            : reloadStatus || "Watching for PDF changes"}
        </span>
      )}
    </div>
  ) : null;
  const addBookmark = () => {
    setBookmarkDraft({ title: `Page ${page}`, page });
  };
  const renameBookmark = (bookmark: Bookmark) => setBookmarkDraft(bookmark);
  const bookmarkDialog = bookmarkDraft && (
    <div className="modal-backdrop">
      <form
        className="settings-dialog"
        role="dialog"
        aria-label="Bookmark"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bookmarkDraft.title.trim()) return;
          const entry = {
            ...bookmarkDraft,
            id: bookmarkDraft.id || crypto.randomUUID(),
            title: bookmarkDraft.title.trim(),
          };
          setBookmarks((current) =>
            bookmarkDraft.id
              ? current.map((b) => (b.id === entry.id ? entry : b))
              : [...current, entry],
          );
          setBookmarkDraft(null);
          setNavigation("bookmarks");
          setRail(true);
        }}
      >
        <h2>Keep your place</h2>
        <p>Page {bookmarkDraft.page} · saved locally for this document</p>
        <label>
          Bookmark name
          <input
            autoFocus
            className="bookmark-name"
            aria-label="Bookmark name"
            value={bookmarkDraft.title}
            maxLength={160}
            onChange={(e) =>
              setBookmarkDraft({ ...bookmarkDraft, title: e.target.value })
            }
          />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={!bookmarkDraft.title.trim()}
        >
          Save bookmark
        </button>
        <button type="button" onClick={() => setBookmarkDraft(null)}>
          Cancel
        </button>
      </form>
    </div>
  );
  const header = (
    <WorkspaceHeader
      busy={busy}
      bytes={bytes}
      goHome={goHome}
      open={open}
      save={save}
      onSettings={() => setSettings(true)}
    />
  );
  const settingsDialog = settings && (
    <Settings
      value={preferences}
      update={updatePreferences}
      close={() => setSettings(false)}
    />
  );
  const appClass = `app theme-${preferences.theme} ${preferences.dark ? "dark-theme" : ""} ${preferences.compact ? "compact" : ""}`;
  if (!pdf)
    return (
      <div
        className={appClass}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) openBrowserFile(file);
        }}
      >
        {header}
        <StartScreen
          busy={busy}
          recents={recents}
          error={error}
          open={open}
          explore={explore}
          openRecent={openRecent}
          removeRecent={removeRecent}
          showExplore={preferences.showExplore}
          onSettings={() => setSettings(true)}
        />
        <footer>
          <span></span>
          <span>Folio</span>
        </footer>
        {settingsDialog}
        <input
          type="file"
          ref={input}
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openBrowserFile(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  return (
    <div
      className={`${appClass}${latex ? " latex-workspace" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) openBrowserFile(file);
      }}
    >
      {header}
      <DocumentTabs
        tabs={tabs}
        activeTabId={activeTabId}
        dirty={dirty}
        name={name}
        busy={busy}
        tabStrip={tabStrip}
        switchTab={switchTab}
        closeTab={closeTab}
        open={open}
        addBookmark={addBookmark}
      />
      <WorkspaceToolbar
        busy={busy}
        latex={latex}
        tool={tool}
        setTool={setTool}
        past={past}
        future={future}
        history={history}
        rail={rail}
        setRail={setRail}
        panel={panel}
        setPanel={setPanel}
        preferences={preferences}
        updatePreferences={updatePreferences}
        note={note}
        setNote={setNote}
        fontSize={fontSize}
        setFontSize={setFontSize}
        color={color}
        setColor={setColor}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="workspace">
        {rail && !latex && (
          <NavigationRail
            pdf={pdf}
            bookmarks={bookmarks}
            setBookmarks={setBookmarks}
            query={query}
            setQuery={setQuery}
            texts={texts}
            page={page}
            setPage={setPage}
            busy={busy}
            merge={merge}
            navigation={navigation}
            setNavigation={setNavigation}
            addBookmark={addBookmark}
            renameBookmark={renameBookmark}
          />
        )}
        <DocumentStage
          pdf={pdf}
          stage={stage}
          tool={tool}
          page={page}
          latex={latex}
          zoom={zoom}
          busy={busy}
          readingHighlight={readingHighlight}
          mark={mark}
          reportError={reportError}
          setPage={setPage}
          goToPage={goToPage}
          setFitMode={setFitMode}
          setZoom={setZoom}
          fit={fit}
          readerIdle={readerIdle}
          note={note}
          fontSize={fontSize}
          color={color}
        />
        {panel === "listen" && !latex ? (
          <Listen
            sidebarControls={latexControls}
            hidden={!preferences.sidebarVisible}
            text={texts[page - 1] || ""}
            page={page}
            texts={texts}
            ready={!busy && texts.length === pdf.numPages}
            documentId={pdf}
            onPage={setPage}
            onReadingHighlight={setReadingHighlight}
            preferences={preferences}
            updatePreferences={updatePreferences}
          />
        ) : (
          <DetailsPanel
            pdf={pdf}
            bytes={bytes}
            page={page}
            latex={latex}
            busy={busy}
            bookmarks={bookmarks}
            edit={edit}
            latexControls={latexControls}
            hidden={!preferences.sidebarVisible}
          />
        )}
      </div>
      <footer>
        <span>
          <span className="status-dot ready" />{" "}
          {window.folio ? "On your Mac" : "Local browser preview"}
        </span>
        <span>
          PDF workspace <span className="footer-dot">·</span> Folio 0.1
        </span>
        <button
          className="text-button"
          onClick={() => setPanel(panel === "details" ? "listen" : "details")}
        >
          {panel === "details" ? "Listen to document" : "Organize pages"}{" "}
          <ChevronRight size={12} />
        </button>
      </footer>
      {settingsDialog}
      {bookmarkDialog}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      <input
        type="file"
        ref={input}
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openBrowserFile(file);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        ref={mergeInput}
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) mergeBrowserFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

