import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Headphones,
  ArrowUpRight,
} from "lucide-react";
import VoiceEditor from "./VoiceEditor";
import { speechError } from "./voice";
import type { VoiceProfile } from "./voice";
import type { Preferences } from "./preferences";
import { readingKey } from "./readingHighlight";
import type { ReadingHighlight } from "./readingHighlight";
import { documentPassages, SpeechQueue } from "./speech";
export default function Listen({
  hidden = false,
  text,
  page,
  texts,
  ready,
  documentId,
  onPage,
  onReadingHighlight,
  preferences,
  updatePreferences,
}: {
  hidden?: boolean;
  text: string;
  page: number;
  texts: string[];
  ready: boolean;
  documentId: object;
  onPage: (page: number) => void;
  onReadingHighlight: (highlight: ReadingHighlight | null) => void;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
}) {
  const [status, setStatus] = useState({
    available: false,
    message: "Checking local speech runtime…",
  });
  const [voice, setVoice] = useState(
    preferences.voice.startsWith("saved:") ? "clone" : preferences.voice,
  );
  const language = preferences.language;
  const speed = preferences.speed;
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [removingVoice, setRemovingVoice] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const expectedPage = useRef(page);
  const [state, setState] = useState<
    "idle" | "generating" | "playing" | "paused"
  >("idle");
  const [progress, setProgress] = useState("");
  const [reference, setReference] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [transcript, setTranscript] = useState("");
  const prepareAll = preferences.prepareAll;
  const [buffer, setBuffer] = useState("");
  const queue = useRef<SpeechQueue<{ audio: string }> | null>(null);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);
  const url = useRef("");
  const endPlayback = useRef<(() => void) | null>(null);
  const speedRef = useRef(1);
  const refresh = () => {
    window.folio
      ?.ttsStatus()
      .then(setStatus)
      .catch((e) => setError(speechError(e))) ??
      setStatus({
        available: false,
        message: "Qwen speech is available in the desktop app.",
      });
  };
  const cleanup = () => {
    onReadingHighlight(null);
    endPlayback.current?.();
    endPlayback.current = null;
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
  };
  const stop = () => {
    request.current++;
    queue.current?.cancel();
    setBuffer("");
    cleanup();
    window.folio?.stopSpeech();
    setState("idle");
    setProgress("");
  };
  useEffect(() => {
    refresh();
    window.folio
      ?.voices()
      .then((saved) => {
        setProfiles(saved);
        const selected = saved.find(
          (v) => "saved:" + v.id === preferences.voice,
        );
        if (selected) {
          setReference(selected);
          setTranscript(selected.transcript);
        }
      })
      .catch((e) => setError(speechError(e)));
    return () => {
      request.current++;
      queue.current?.cancel();
      cleanup();
      window.folio?.stopSpeech();
    };
  }, []);
  useEffect(() => {
    stop();
  }, [documentId]);
  useEffect(() => {
    if (page !== expectedPage.current) stop();
    expectedPage.current = page;
  }, [page]);
  useEffect(() => {
    speedRef.current = Number(speed);
    if (audio.current) audio.current.playbackRate = Number(speed);
  }, [speed]);
  const removeVoice = async () => {
    if (!reference || !window.folio || removingVoice) return;
    const selected = reference;
    if (!window.confirm(`Remove “${selected.name}” and its saved recording from Folio? Your original recording will be kept.`)) return;
    setRemovingVoice(true);
    try {
      stop();
      await window.folio.removeVoice(selected.id);
      setProfiles(current => current.filter(p => p.id !== selected.id));
      setReference(null);
      setTranscript("");
      setEditing(null);
      setVoice("Ryan");
      updatePreferences({ voice: "Ryan" });
      setProfileMessage("Voice removed.");
      setError("");
    } catch (e) { setError(speechError(e)); }
    finally { setRemovingVoice(false); }
  };
  const start = async () => {
    if (state === "playing") {
      audio.current?.pause();
      setState("paused");
      return;
    }
    if (state === "paused") {
      try {
        await audio.current?.play();
        setState("playing");
      } catch (e) {
        setError(speechError(e));
      }
      return;
    }
    const selected = window.getSelection()?.toString().trim();
    const chunks = documentPassages(
      texts,
      page,
      preferences.continuePages,
      selected,
    );
    if (!chunks.length) {
      setError(
        "No readable text was found. Scanned pages need OCR before they can be read aloud.",
      );
      return;
    }
    if (!window.folio) return;
    const id = ++request.current;
    setError("");
    setState("generating");
    const bridge = window.folio;
    const prepared = new Set<number>();
    let playingIndex = -1;
    const pending = new SpeechQueue(
      chunks,
      (passage) =>
        bridge.speak(
          passage,
          voice,
          language,
          voice === "clone" && reference
            ? { id: reference.id, transcript }
            : undefined,
        ),
      (index) => {
        prepared.add(index);
        if (request.current === id)
          setBuffer(
            `${[...prepared].filter((n) => n > playingIndex).length} passages ready ahead`,
          );
      },
    );
    queue.current = pending;
    let highlightPage = -1;
    let highlightCursor = 0;
    try {
      setProgress(
        prepareAll
          ? "Preparing the whole reading…"
          : `Preparing the first ${preferences.lookahead} passages…`,
      );
      const initialLast = prepareAll
        ? chunks.length - 1
        : Math.min(preferences.lookahead - 1, chunks.length - 1);
      pending.prepareThrough(initialLast);
      // Check each startup result so a failed early passage does not go unnoticed.
      for (let n = 0; n <= initialLast; n++) await pending.get(n);
      for (const [i, chunk] of chunks.entries()) {
        if (request.current !== id) return;
        playingIndex = i;
        if (!prepared.has(i)) {
          setState("generating");
          setBuffer("Catching up — waiting for the next passage…");
        }
        setProgress(
          `Page ${chunk.page} · paragraph ${chunk.paragraph}${chunk.parts > 1 ? ` · part ${chunk.part}/${chunk.parts}` : ""}`,
        );
        const result = await pending.get(i);
        if (request.current !== id) return;
        expectedPage.current = chunk.page;
        onPage(chunk.page);
        pending.release(i);
        prepared.delete(i);
        // Generate the next two passages while this one plays. Only one model job runs at once.
        pending.prepareThrough(i + preferences.lookahead);
        setBuffer(
          `${[...prepared].filter((n) => n > i).length} passages ready ahead`,
        );
        const bytes = Uint8Array.from(atob(result.audio), (c) =>
          c.charCodeAt(0),
        );
        cleanup();
        url.current = URL.createObjectURL(
          new Blob([bytes], { type: "audio/wav" }),
        );
        if (highlightPage !== chunk.page) {
          highlightPage = chunk.page;
          highlightCursor = 0;
        }
        const key = readingKey(chunk.text);
        const start = readingKey(texts[chunk.page - 1] || "").indexOf(key, highlightCursor);
        const highlight = start < 0 ? null : { page: chunk.page, start, end: start + key.length };
        if (highlight) highlightCursor = highlight.end;
        const player = new Audio(url.current);
        audio.current = player;
        player.playbackRate = speedRef.current;
        await new Promise<void>((resolve, reject) => {
          endPlayback.current = resolve;
          player.onended = () => {
            if (request.current === id) onReadingHighlight(null);
            resolve();
          };
          player.onerror = () =>
            reject(new Error("Unable to play the generated audio."));
          player
            .play()
            .then(() => {
              if (request.current === id) {
                setState("playing");
                onReadingHighlight(highlight);
              }
            })
            .catch(reject);
        });
      }
      if (request.current === id) {
        cleanup();
        setState("idle");
        setProgress("Reading complete");
        setBuffer("");
      }
    } catch (e) {
      if (request.current === id) {
        pending.cancel();
        cleanup();
        void bridge.stopSpeech();
        setError(speechError(e));
        setState("idle");
        setProgress("");
        setBuffer("");
      }
    }
  };
  const chooseReference = async () => {
    try {
      const file = await window.folio?.chooseVoice();
      if (file)
        setEditing({
          ...file,
          name: file.name.replace(/\.[^.]+$/, ""),
          transcript: "",
        });
    } catch (e) {
      setError(speechError(e));
    }
  };
  const savedProfile = profiles.find((v) => v.id === reference?.id);
  const savedReference = !!savedProfile;
  const needsReview =
    savedReference &&
    (savedProfile.end === undefined || savedProfile.duration === undefined);

  return (
    <aside id="right-sidebar" className="listen-panel" hidden={hidden}>
      <div className="panel-heading">
        <span>
          <Headphones size={16} /> Listen
        </span>
        <span className="beta">LOCAL AI</span>
      </div>
      <div className="listen-body">
        <p className="listen-caption">Natural speech, right on your Mac.</p>
        <label>
          Voice
          <select
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              updatePreferences({
                voice:
                  e.target.value === "clone" && savedReference
                    ? "saved:" + reference!.id
                    : e.target.value,
              });
            }}
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
                  onChange={(e) => {
                    const profile = profiles.find(
                      (p) => p.id === e.target.value,
                    );
                    if (profile) {
                      setReference(profile);
                      setTranscript(profile.transcript);
                      setProfileMessage("");
                      setError("");
                      updatePreferences({ voice: "saved:" + profile.id });
                    }
                  }}
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
                  onClick={() =>
                    setEditing(profiles.find((p) => p.id === reference!.id)!)
                  }
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
          close={() => setEditing(null)}
          save={(saved) => {
            setProfiles((current) => [
              ...current.filter((p) => p.id !== saved.id),
              saved,
            ]);
            setReference(saved);
            setTranscript(saved.transcript);
            setProfileMessage("Voice validated and saved.");
            setError("");
            setProgress("");
            updatePreferences({ voice: "saved:" + saved.id });
            setEditing(null);
          }}
        />
      )}
    </aside>
  );
}
