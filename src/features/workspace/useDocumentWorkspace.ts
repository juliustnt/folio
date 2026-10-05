import { useCallback, useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import type { Tool } from "../reader/PdfPage";
import type { ReadingHighlight } from "../reader/readingHighlight";
import { readLocal, writeLocal } from "../settings/preferences";
import type { Bookmark, Preferences } from "../settings/preferences";
import { extractReadingText } from "../listen/speech";
import { addMark, createWelcome, mergePdf } from "../reader/pdf";
import type { Mark } from "../reader/pdf";
import type { DocumentSource, DocumentSnapshot, FitMode, DocumentTab } from "../../models/workspace";
import { documentIdentity } from "./documentIdentity";
import { usePageNavigation, usePageFit } from "../reader/useReaderViewport";
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
    const loadingTask = getDocument({
      data: data.slice(),
      wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, document.baseURI).href,
    });
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
    if (busy) return;
    const current = activeTab();
    if (current) {
      setTabs((items) => items.map((tab) => tab.id === current.id ? current : tab));
    }
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
