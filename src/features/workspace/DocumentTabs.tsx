import { Check, FileText, Plus, X, BookmarkPlus } from "lucide-react";
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
  addBookmark?: () => void;
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
      {addBookmark && (
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
      )}
    </div>
  );
}
