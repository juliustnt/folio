import { ArrowDown, ArrowUp, FileText, RotateCw, Trash2 } from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";
import type { ReactNode } from "react";
import { sidebarSplash } from "./splashes";
import { rotatePage, movePage, deletePage } from "../reader/pdf";
import { remapBookmarks } from "../settings/preferences";

type DetailsPanelProps = Pick<
  DocumentWorkspace,
  "pdf" | "bytes" | "page" | "latex" | "busy" | "bookmarks" | "edit"
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
    <aside id="right-sidebar" className="details-panel" hidden={hidden}>
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
        <div className="page-edit-actions" hidden={latex}>
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
        {latexControls}
      </div>
    </aside>
  );
}
