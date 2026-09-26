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
