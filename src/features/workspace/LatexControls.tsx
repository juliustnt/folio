import type { DocumentWorkspace } from "./useDocumentWorkspace";

type LatexControlsProps = Pick<
  DocumentWorkspace,
  "source" | "latex" | "dirty" | "reloadStatus" | "setLatex" | "setReloadStatus"
>;

export function LatexControls({
  source,
  latex,
  dirty,
  reloadStatus,
  setLatex,
  setReloadStatus,
}: LatexControlsProps) {
  return (
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
  );
}
