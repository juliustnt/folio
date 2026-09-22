import { useCallback, useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  Headphones,
  Highlighter,
  Maximize,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Trash2,
  Type,
  Undo2,
  X,
  Download,
  Layers,
  Home,
  Settings2,
  BookmarkPlus,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import { readerShortcut } from "./readerControls";
import { sidebarSplash, startupSplash } from "./splashes";
import { PdfPage } from "./PdfPage";
import type { Tool } from "./PdfPage";
import Listen from "./Listen";
import type { ReadingHighlight } from "./readingHighlight";
import Contents from "./Contents";
import Settings from "./Settings";
import {
  usePreferences,
  readLocal,
  writeLocal,
  remapBookmarks,
} from "./preferences";
import type { Bookmark } from "./preferences";
import { extractReadingText } from "./speech";
import {
  addMark,
  createWelcome,
  deletePage,
  mergePdf,
  movePage,
  rotatePage,
} from "./pdf";
import type { Mark } from "./pdf";
import { PDFDocument } from "pdf-lib";
GlobalWorkerOptions.workerSrc = workerUrl;
async function documentIdentity(data: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
type Snapshot = { bytes: Uint8Array; page: number; bookmarks: Bookmark[] };
export default function App() {
  const [preferences, updatePreferences] = usePreferences();
  const [settings, setSettings] = useState(false);
  const [navigation, setNavigation] = useState<
    "pages" | "contents" | "bookmarks"
  >("pages");
  const [recents, setRecents] = useState<
    { id: string; name: string; path: string; openedAt: string }[]
  >([]);
  const [bookmarkDraft, setBookmarkDraft] = useState<{
    id?: string;
    title: string;
    page: number;
  } | null>(null);
  const [documentKey, setDocumentKey] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const refreshRecents = () => {
    window.folio
      ?.recents()
      .then(setRecents)
      .catch((e) => setError(String(e)));
  };
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fitMode, setFitMode] = useState<"manual" | "width" | "page">(
    preferences.fitPage ? "page" : "manual",
  );
  const [name, setName] = useState("Welcome to Folio.pdf");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(preferences.zoom);
  const [tool, setTool] = useState<Tool>("select");
  const panel = preferences.panel;
  const setPanel = (panel: "listen" | "details") =>
    updatePreferences({ panel, sidebarVisible: true });
  const rail = preferences.navigationVisible;
  const setRail = (navigationVisible: boolean) =>
    updatePreferences({ navigationVisible });
  const [query, setQuery] = useState("");
  const [readingHighlight, setReadingHighlight] = useState<ReadingHighlight | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [color, setColor] = useState("#c5a634");
  const [fontSize, setFontSize] = useState(preferences.fontSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedBytes, setSavedBytes] = useState<Uint8Array | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const currentPdf = useRef<PDFDocumentProxy | null>(null);
  const currentLoadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const lock = useRef(false);
  const dirty = bytes !== savedBytes;
  const reportError = useCallback((message: string) => setError(message), []);
  const load = async (
    data: Uint8Array,
    targetPage = 1,
    newDocument = false,
  ) => {
    // Validate mutability before showing a file as editable. Encrypted files are not silently decrypted.
    await PDFDocument.load(data);
    const loadingTask = getDocument({ data: data.slice() });
    const loaded = await loadingTask.promise;
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
    if (oldLoadingTask)
      setTimeout(() => void oldLoadingTask.destroy(), 100);
    const content: string[] = [];
    for (let n = 1; n <= loaded.numPages; n++) {
      if (currentPdf.current !== loaded) break;
      try {
        const data = await (await loaded.getPage(n)).getTextContent();
        content.push(extractReadingText(data.items));
      } catch {
        content.push("");
      }
      if (currentPdf.current === loaded) setTexts([...content]);
    }
  };
  useEffect(() => {
    refreshRecents();
  }, []);
  useEffect(() => {
    setFontSize(preferences.fontSize);
  }, [preferences.fontSize]);
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
    window.folio?.setDirty(dirty);
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);
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
  const replace = async (data: Uint8Array, filename: string) => {
    if (
      dirty &&
      !window.confirm("Open another PDF and discard your unsaved changes?")
    )
      return;
    await load(data, 1, true);
    setName(filename);
    setSavedBytes(data);
    setPast([]);
    setFuture([]);
    setTool("select");
    setQuery("");
    refreshRecents();
  };
  const [pendingOpen, setPendingOpen] = useState(0);
  const checkingOpen = useRef(false);
  useEffect(() => window.folio?.onPendingPdf(() => setPendingOpen(n => n + 1)), []);
  useEffect(() => {
    if (!window.folio || busy || checkingOpen.current) return;
    checkingOpen.current = true;
    void window.folio.nextPdf().then(async file => {
      if (file) {
        await task(() => replace(new Uint8Array(file.data), file.name));
        setPendingOpen(n => n + 1);
      }
    }).catch(e => {
      setError(e instanceof Error ? e.message : String(e));
      setPendingOpen(n => n + 1);
    }).finally(() => { checkingOpen.current = false; });
  }, [busy, pendingOpen]);
  const open = () => {
    if (window.folio)
      void task(async () => {
        const file = await window.folio!.openPdf();
        if (file) await replace(new Uint8Array(file.data), file.name);
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
      setPast((history) => [...history.slice(-11), { bytes, page, bookmarks }]);
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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = readerShortcut(e);
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (action && !target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]') && !settings && !document.querySelector('[role="dialog"]')) {
        if (!pdf || busy) return;
        e.preventDefault();
        if (action === "zoom-in" || action === "zoom-out" || action === "actual-size") {
          setFitMode("manual");
          setZoom(current => action === "actual-size" ? 1 : Math.max(0.3, Math.min(3, Math.round((current + (action === "zoom-in" ? 0.1 : -0.1)) * 100) / 100)));
        } else {
          setPage(current => action === "first-page" ? 1 : action === "last-page" ? pdf.numPages : Math.max(1, Math.min(pdf.numPages, current + (action === "next-page" ? 1 : -1))));
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
  const merge = () => {
    if (window.folio)
      void task(async () => {
        const file = await window.folio!.openPdf();
        if (file && bytes) {
          const next = await mergePdf(bytes, new Uint8Array(file.data));
          await load(next, page);
          setPast([...past.slice(-11), { bytes, page, bookmarks }]);
          setFuture([]);
          setNotice("Pages added to your document.");
        }
      });
    else mergeInput.current?.click();
  };
  const mark = (value: Mark) => edit((data) => addMark(data, page - 1, value));
  const fit = () => setFitMode("width");
  useEffect(() => {
    if (!pdf || !stage.current || fitMode === "manual") return;
    let cancelled = false;
    const container = stage.current;
    const update = async () => {
      const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });
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
    const observer = new ResizeObserver(() => {
      void update().catch(() => {});
    });
    observer.observe(container);
    void update().catch(() => {});
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pdf, page, fitMode]);

  const goHome = () => {
    if (
      dirty &&
      !window.confirm("Return to Start and discard unsaved PDF changes?")
    )
      return;
    setDocumentKey("");
    setBookmarks([]);
    setPdf(null);
    setBytes(null);
    setSavedBytes(null);
    setTexts([]);
    setPast([]);
    setFuture([]);
    const previousLoadingTask = currentLoadingTask.current;
    currentLoadingTask.current = null;
    currentPdf.current = null;
    setTimeout(() => void previousLoadingTask?.destroy(), 100);
    refreshRecents();
  };
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
  const tools: { id: Tool; label: string; icon: typeof MousePointer2 }[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "highlight", label: "Highlight", icon: Highlighter },
    { id: "text", label: "Add text", icon: Type },
    { id: "pen", label: "Draw", icon: PenLine },
  ];
  const header = (
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
          onClick={() => setSettings(true)}
        >
          <Settings2 size={17} />
        </button>
        {/* <span className="local-badge">
          <ShieldCheck size={13} /> Local & private
        </span> */}
        <button onClick={open} disabled={busy}>
          <FolderOpen size={15} /> Open PDF <kbd>⌘O</kbd>
        </button>
        <button className="primary" onClick={save} disabled={!bytes || busy}>
          <Download size={15} /> Save a copy
        </button>
      </div>
    </header>
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
          if (file)
            void task(async () =>
              replace(new Uint8Array(await file.arrayBuffer()), file.name),
            );
        }}
      >
        {header}
        <main className="start-screen">
          <div className="start-intro">
            <h1>
              {startupSplash[0]}
              <br />{startupSplash[1]}
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
              {preferences.showExplore && <button
                className="start-action"
                disabled={busy}
                onClick={() =>
                  void task(async () =>
                    replace(await createWelcome(), "Welcome to Folio.pdf"),
                  )
                }
              >
                <BookOpen size={21} />
                <span>
                  Explore Folio
                  <small>Open the sample document and try the tools.</small>
                </span>
              </button>}
              <button
                className="start-action"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={21} />
                <span>
                  Settings
                  <small>Your reading, voice, and workspace preferences.</small>
                </span>
              </button>
              <div className="start-note">Drop a PDF anywhere to open it.</div>
            </section>
            <section>
              <h2>Recent documents</h2>
              {recents.length ? (
                recents.map((recent) => (
                  <button
                    className="recent-file"
                    disabled={busy}
                    key={recent.id}
                    onClick={() =>
                      void task(async () => {
                        const file = await window.folio!.openRecent(recent.id);
                        await replace(new Uint8Array(file.data), file.name);
                      })
                    }
                  >
                    <FileText size={18} />
                    <span>
                      {recent.name}
                      <small title={recent.path}>{recent.path}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <div className="empty-recents">
                  <FileText size={28} />
                  <p>Your next read starts here.</p>
                  <small>PDFs you open will appear in this list.</small>
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
            if (file)
              void task(async () =>
                replace(new Uint8Array(await file.arrayBuffer()), file.name),
              );
            e.target.value = "";
          }}
        />
      </div>
    );
  return (
    <div
      className={appClass}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file)
          void task(async () =>
            replace(new Uint8Array(await file.arrayBuffer()), file.name),
          );
      }}
    >
      {header}
      <div className="document-bar">
        <div className="document-tab">
          <FileText size={16} />
          <span>{name}</span>
          {dirty && <span className="unsaved-dot" title="Unsaved changes" />}
        </div>
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
          {tools.map(({ id, label, icon: Icon }) => (
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
            onClick={() => setPanel(panel === "listen" && preferences.sidebarVisible ? "details" : "listen")}
          >
            <Headphones size={16} />
            <span>Listen</span>
          </button>
          <button
            className="icon-button"
            title={preferences.sidebarVisible ? "Hide right sidebar" : "Show right sidebar"}
            aria-label={preferences.sidebarVisible ? "Hide right sidebar" : "Show right sidebar"}
            aria-expanded={preferences.sidebarVisible}
            aria-controls="right-sidebar"
            onClick={() => updatePreferences({ sidebarVisible: !preferences.sidebarVisible })}
          >
            {preferences.sidebarVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </div>
      {tool !== "select" && (
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
        {rail && (
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
        )}
        <main className="document-stage" ref={stage}>
          <div className="canvas-heading">
            <span>
              {tool === "select" ? "A LITTLE ROOM TO FOCUS" : "MAKE IT YOURS"}
            </span>
            <span>
              PAGE {String(page).padStart(2, "0")} /{" "}
              {String(pdf?.numPages || 0).padStart(2, "0")}
            </span>
          </div>
          <div className="paper-scroll">
            {pdf ? (
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
              onClick={() => setPage(page - 1)}
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
              onClick={() => setPage(page + 1)}
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
        {panel === "listen" ? (
          <Listen
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
          <aside id="right-sidebar" className="details-panel" hidden={!preferences.sidebarVisible}>
            <div className="panel-heading">
              <span>
                <FileText size={16} /> Document
              </span>
            </div>
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
            <div className="page-actions">
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
          if (file)
            void task(async () =>
              replace(new Uint8Array(await file.arrayBuffer()), file.name),
            );
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
          if (file)
            edit(async (data) =>
              mergePdf(data, new Uint8Array(await file.arrayBuffer())),
            );
          e.target.value = "";
        }}
      />
    </div>
  );
}
