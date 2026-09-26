import { useEffect, useRef, useState } from "react";
import { X, Play } from "lucide-react";
import type { VoiceProfile } from "./voice";
import { speechError } from "./voice";
export default function VoiceEditor({
  profile,
  save,
  close,
}: {
  profile: VoiceProfile;
  save: (profile: VoiceProfile) => void;
  close: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [transcript, setTranscript] = useState(profile.transcript);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(profile.start || 0);
  const [end, setEnd] = useState(profile.end || 0);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [matched, setMatched] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    let cancelled = false;
    let url = "";
    window
      .folio!.inspectVoice(profile.id)
      .then((info) => {
        if (cancelled) return;
        setDuration(info.duration);
        setEnd(profile.end ?? Math.min(30, info.duration));
        const bytes = Uint8Array.from(atob(info.audio), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
        setSource(url);
        setMatched(
          profile.end !== undefined && profile.end - (profile.start || 0) <= 30,
        );
      })
      .catch((e) => {
        if (!cancelled) setError(speechError(e));
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profile.id]);
  const valid =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end <= duration + 0.02 &&
    end - start >= 3 &&
    end - start <= 30;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.folio!.saveVoice({
        id: profile.id,
        name,
        transcript,
        start,
        end,
      });
      save(result);
    } catch (e) {
      setError(speechError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="settings-dialog voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit voice"
      >
        <header>
          <h2>Set up your voice</h2>
          <button
            aria-label="Close voice editor"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          The original recording is kept intact. Choose a short speech segment
          for Qwen.
        </p>
        {!duration && !error && <p role="status">Inspecting recording…</p>}
        {source && (
          <>
            <audio
              ref={audio}
              src={source}
              controls
              preload="metadata"
              onTimeUpdate={() => {
                if (audio.current && audio.current.currentTime >= end)
                  audio.current.pause();
              }}
            />
            <p>
              Recording: {duration.toFixed(1)} seconds · selected:{" "}
              {(end - start).toFixed(1)} seconds
            </p>
            <div className="settings-grid">
              <label>
                Start (seconds)
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step="0.1"
                  value={start}
                  onChange={(e) => {
                    setStart(Number(e.target.value));
                    setMatched(false);
                  }}
                />
              </label>
              <label>
                End (seconds)
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step="0.1"
                  value={end}
                  onChange={(e) => {
                    setEnd(Number(e.target.value));
                    setMatched(false);
                  }}
                />
              </label>
            </div>
            <button
              disabled={!valid}
              onClick={() => {
                if (audio.current) {
                  audio.current.currentTime = start;
                  void audio.current
                    .play()
                    .catch((e) => setError(speechError(e)));
                }
              }}
            >
              <Play size={14} /> Preview selected segment
            </button>
            {!valid && (
              <p className="inline-error">
                Select 3–30 seconds within the recording.
              </p>
            )}
          </>
        )}
        <label>
          Voice name
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label="Voice name"
          />
        </label>
        <label>
          Transcript for the selected segment
          <textarea
            aria-label="Segment transcript"
            value={transcript}
            maxLength={2000}
            onChange={(e) => {
              setTranscript(e.target.value);
              setMatched(false);
            }}
          />
        </label>
        <p>
          Include only words spoken between {start.toFixed(1)} and{" "}
          {end.toFixed(1)} seconds. A full-recording transcript will not match a
          shorter segment.
        </p>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={matched}
            onChange={(e) => setMatched(e.target.checked)}
          />{" "}
          The transcript matches this selected segment
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={
            busy || !valid || !matched || !name.trim() || !transcript.trim()
          }
          onClick={submit}
        >
          {busy ? "Validating and saving…" : "Save voice"}
        </button>
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
      </section>
    </div>
  );
}
