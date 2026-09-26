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
