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
