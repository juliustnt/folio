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
