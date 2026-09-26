import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BookmarkDialog } from "./workspace/BookmarkDialog";
import type { BookmarkDraft } from "./workspace/BookmarkDialog";
import { LatexControls } from "./workspace/LatexControls";
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
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);
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
    <LatexControls
      source={source}
      latex={latex}
      dirty={dirty}
      reloadStatus={reloadStatus}
      setLatex={setLatex}
      setReloadStatus={setReloadStatus}
    />
  ) : null;
  const addBookmark = () => {
    setBookmarkDraft({ title: `Page ${page}`, page });
  };
  const renameBookmark = (bookmark: Bookmark) => setBookmarkDraft(bookmark);
  const saveBookmark = (bookmarkDraft: BookmarkDraft, e: FormEvent<HTMLFormElement>) => {
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
  };
  const bookmarkDialog = bookmarkDraft && (
    <BookmarkDialog
      bookmarkDraft={bookmarkDraft}
      onSubmit={(e) => saveBookmark(bookmarkDraft, e)}
      onChange={setBookmarkDraft}
      onClose={() => setBookmarkDraft(null)}
    />
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
