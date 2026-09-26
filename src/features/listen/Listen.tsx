import type { ReactNode } from "react";
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Headphones,
  ArrowUpRight,
} from "lucide-react";
import VoiceEditor from "./VoiceEditor";
import { useListenController } from "./useListenController";
import type { ListenControllerOptions } from "./useListenController";

type ListenProps = ListenControllerOptions & {
  hidden?: boolean;
  sidebarControls?: ReactNode;
  text: string;
  ready: boolean;
};

export default function Listen({
  hidden = false,
  sidebarControls,
  text,
  ready,
  ...controllerOptions
}: ListenProps) {
  const { page, preferences, updatePreferences } = controllerOptions;
  const {
    status,
    voice,
    language,
    speed,
    profiles,
    editing,
    removingVoice,
    profileMessage,
    state,
    progress,
    reference,
    transcript,
    prepareAll,
    buffer,
    error,
    savedReference,
    needsReview,
    refresh,
    stop,
    start,
    removeVoice,
    chooseReference,
    selectVoice,
    selectProfile,
    editReference,
    closeEditor,
    saveProfile,
  } = useListenController(controllerOptions);

  return (
    <aside id="right-sidebar" className="listen-panel" hidden={hidden}>
      <div className="panel-heading">
        <span>
          <Headphones size={16} /> Listen
        </span>
        <span className="beta">LOCAL AI</span>
      </div>
      {sidebarControls}
      <div className="listen-body">
        <p className="listen-caption">Natural speech, right on your Mac.</p>
        <label>
          Voice
          <select
            value={voice}
            onChange={(e) => selectVoice(e.target.value)}
            disabled={removingVoice || state !== "idle"}
          >
            <option value="clone">My cloned voice</option>
            {[
              "Ryan",
              "Aiden",
              "Vivian",
              "Serena",
              "Uncle_Fu",
              "Dylan",
              "Eric",
              "Ono_Anna",
              "Sohee",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {voice === "clone" && (
          <div className="clone-summary">
            {profiles.length > 0 && (
              <label>
                Saved voices
                <select
                  aria-label="Saved voices"
                  disabled={removingVoice || state !== "idle"}
                  value={savedReference ? reference!.id : ""}
                  onChange={(e) => selectProfile(e.target.value)}
                >
                  <option value="" disabled>
                    Select a saved voice
                  </option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="voice-actions">
              {savedReference && <button disabled={removingVoice || state !== "idle"}
                onClick={() => void removeVoice()}>{removingVoice ? "Removing…" : "Remove"}</button>}
              <button
                onClick={chooseReference}
                disabled={removingVoice || state !== "idle" || !window.folio}
              >
                New voice
              </button>
              {savedReference && (
                <button
                  disabled={removingVoice || state !== "idle"}
                  onClick={editReference}
                >
                  Edit voice
                </button>
              )}
            </div>
            {savedReference && (
              <p>
                {needsReview
                  ? "This older profile needs a segment check. Open Edit voice before reading."
                  : "Recording and transcript saved on this Mac."}
              </p>
            )}
            {profileMessage && <p role="status">{profileMessage}</p>}
          </div>
        )}
        <label className="buffer-option">
          <input
            type="checkbox"
            checked={prepareAll}
            disabled={removingVoice || state !== "idle"}
            onChange={(e) =>
              updatePreferences({ prepareAll: e.target.checked })
            }
          />{" "}
          Prepare the entire reading before playing
        </label>
        <label className="buffer-option">
          <input
            type="checkbox"
            checked={preferences.continuePages}
            disabled={removingVoice || state !== "idle"}
            onChange={(e) =>
              updatePreferences({ continuePages: e.target.checked })
            }
          />{" "}
          Continue onto the next page
        </label>
        <div className="field-row">
          <label>
            Language
            <select
              value={language}
              onChange={(e) => updatePreferences({ language: e.target.value })}
              disabled={removingVoice || state !== "idle"}
            >
              {[
                "English",
                "Chinese",
                "Japanese",
                "Korean",
                "German",
                "French",
                "Russian",
                "Portuguese",
                "Spanish",
                "Italian",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Speed
            <select
              value={speed}
              onChange={(e) => updatePreferences({ speed: e.target.value })}
            >
              {["0.75", "1", "1.25", "1.5", "2"].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="listen-playback">
        <button
          className="primary listen-button"
          disabled={
            removingVoice ||
            !ready ||
            !status.available ||
            (!text.trim() && !preferences.continuePages) ||
            state === "generating" ||
            (voice === "clone" &&
              (!savedReference || needsReview || !transcript.trim()))
          }
          onClick={start}
        >
          {state === "generating" ? (
            <RefreshCw size={16} className="spin" />
          ) : state === "playing" ? (
            <Pause size={16} />
          ) : (
            <Play size={16} />
          )}{" "}
          {state === "generating"
            ? "Preparing speech…"
            : state === "playing"
              ? "Pause reading"
              : state === "paused"
                ? "Resume reading"
                : `Read page ${page}`}
        </button>
        {state !== "idle" && (
          <button className="stop-button" onClick={stop}>
            <Square size={13} /> Stop reading
          </button>
        )}
        <p className="reading-status" aria-live="polite">
          {progress || ""}
          {buffer && (
            <>
              <br />
              {buffer}
            </>
          )}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <details className="runtime-note">
        <summary>Qwen runtime & privacy</summary>
        <span className={`status-dot ${status.available ? "ready" : ""}`} />
        <strong>
          {status.available ? "Ready on your Mac" : "Set up local speech"}
        </strong>
        <p>{status.message}</p>
        {!status.available && window.folio && (
          <>
            <code>npm run setup:tts</code>
            <p>
              Run once in the project folder. The model downloads on your first
              reading.
            </p>
          </>
        )}
        <button className="text-button" onClick={refresh}>
          Check connection <RefreshCw size={12} />
        </button>
      </details>
      <div className="privacy-foot">
        <ArrowUpRight size={13} /> Your words stay yours. Processed locally.
      </div>
      {editing && (
        <VoiceEditor
          profile={editing}
          close={closeEditor}
          save={saveProfile}
        />
      )}
    </aside>
  );
}
