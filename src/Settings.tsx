import { X, Settings2 } from "lucide-react";
import { defaults } from "./preferences";
import type { Preferences } from "./preferences";
export default function Settings({
  value,
  update,
  close,
}: {
  value: Preferences;
  update: (patch: Partial<Preferences>) => void;
  close: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>
            <Settings2 size={22} /> Settings
          </h2>
          <button aria-label="Close settings" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <h3>Workspace</h3>
        <div className="settings-grid">
          <label>
            Default zoom
            <select
              value={value.zoom}
              onChange={(e) => update({ zoom: Number(e.target.value) })}
            >
              {[0.5, 0.75, 0.9, 1, 1.25, 1.5].map((n) => (
                <option key={n} value={n}>
                  {n * 100}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Annotation text size
            <select
              value={value.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
            >
              {[10, 12, 16, 20, 24, 32].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.fitPage}
            onChange={(e) => update({ fitPage: e.target.checked })}
          />{" "}
          Fit the whole page to the window on open
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.rememberPage}
            onChange={(e) => update({ rememberPage: e.target.checked })}
          />{" "}
          Remember the last page in each document
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.compact}
            onChange={(e) => update({ compact: e.target.checked })}
          />{" "}
          Compact interface
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.dark}
            onChange={(e) => update({ dark: e.target.checked })}
          />{" "}
          Dark burgundy workspace
        </label>
        <h3>Listening</h3>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.continuePages}
            onChange={(e) => update({ continuePages: e.target.checked })}
          />{" "}
          Continue to the next page automatically
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.prepareAll}
            onChange={(e) => update({ prepareAll: e.target.checked })}
          />{" "}
          Prepare the complete reading before playback
        </label>
        <div className="settings-grid">
          <label>
            Passages to preload
            <select
              value={value.lookahead}
              onChange={(e) => update({ lookahead: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Playback speed
            <select
              value={value.speed}
              onChange={(e) => update({ speed: e.target.value })}
            >
              {["0.75", "1", "1.25", "1.5", "2"].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <button onClick={() => update(defaults)}>Restore defaults</button>
      </section>
    </div>
  );
}
