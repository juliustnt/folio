import { useState } from "react";
import { X, Settings2 } from "lucide-react";
import { defaults, themes } from "./preferences";
import type { Preferences, Theme } from "./preferences";
export default function Settings({
  value,
  update,
  close,
}: {
  value: Preferences;
  update: (patch: Partial<Preferences>) => void;
  close: () => void;
}) {
  const [finderBusy, setFinderBusy] = useState(false);
  const [finderMessage, setFinderMessage] = useState("");
  const [finderError, setFinderError] = useState(false);
  const finderAction = async (repair: boolean) => {
    if (!window.folio || finderBusy) return;
    setFinderBusy(true);
    setFinderMessage("");
    setFinderError(false);
    try {
      if (repair) {
        const result = await window.folio.repairPdfOpening();
        if (result) setFinderMessage(result.repaired
          ? `${result.name} now uses your default PDF app. Try opening it from Finder again.`
          : `${result.name} has no individual Open With override. Open it using Folio’s Open a PDF button; this repair does not apply to its warning.`);
      } else {
        await window.folio.setDefaultPdfApp();
        setFinderMessage("Folio is now your default PDF app.");
      }
    } catch (e) {
      setFinderError(true);
      setFinderMessage((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""));
    } finally { setFinderBusy(false); }
  };
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
        {window.folio?.macOS && <>
          <h3>Opening PDFs from Finder</h3>
          <p>Set Folio as the default for all PDFs. If a PDF shows an Apple verification warning after using Always Open With, repair that file’s opening preference.</p>
          <div className="voice-actions">
            <button disabled={finderBusy} onClick={() => void finderAction(false)}>Make Folio the default PDF app</button>
            <button disabled={finderBusy} onClick={() => void finderAction(true)}>Repair Finder opening…</button>
          </div>
          {finderMessage && <p role={finderError ? "alert" : "status"}>{finderMessage}</p>}
        </>}
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
          <input type="checkbox" checked={value.showExplore}
            onChange={(e) => update({ showExplore: e.target.checked })} />{" "}
          Show Explore Folio on the start screen
        </label>
        <h3>Appearance</h3>
        <div className="settings-grid">
          <label>
            Theme
            <select
              value={value.theme}
              onChange={(e) => update({ theme: e.target.value as Theme })}
            >
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={value.dark}
            onChange={(e) => update({ dark: e.target.checked })}
          />{" "}
          Dark mode
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
