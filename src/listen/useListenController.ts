import { useEffect, useRef, useState } from "react";
import type { Preferences } from "../preferences";
import { readingKey } from "../readingHighlight";
import type { ReadingHighlight } from "../readingHighlight";
import { documentPassages, SpeechQueue } from "../speech";
import { speechError } from "../voice";
import type { VoiceProfile } from "../voice";

export type ListenControllerOptions = {
  page: number;
  texts: string[];
  documentId: object;
  onPage: (page: number) => void;
  onReadingHighlight: (highlight: ReadingHighlight | null) => void;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
};

/** Owns local speech resources, playback cancellation, and voice selection. */
export function useListenController({
  page,
  texts,
  documentId,
  onPage,
  onReadingHighlight,
  preferences,
  updatePreferences,
}: ListenControllerOptions) {
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

  const selectVoice = (value: string) => {
    setVoice(value);
    updatePreferences({
      voice:
        value === "clone" && savedReference
          ? "saved:" + reference!.id
          : value,
    });
  };
  const selectProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      setReference(profile);
      setTranscript(profile.transcript);
      setProfileMessage("");
      setError("");
      updatePreferences({ voice: "saved:" + profile.id });
    }
  };
  const editReference = () =>
    setEditing(profiles.find((p) => p.id === reference!.id)!);
  const closeEditor = () => setEditing(null);
  const saveProfile = (saved: VoiceProfile) => {
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
  };

  return {
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
  };
}
