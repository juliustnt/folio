import { useEffect, useState } from "react";

const READER_IDLE_DELAY_MS = 3000;

export function useReaderIdle() {
  const [readerIdle, setReaderIdle] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const revealControls = () => {
      setReaderIdle(false);
      clearTimeout(timeout);
      timeout = setTimeout(() => setReaderIdle(true), READER_IDLE_DELAY_MS);
    };
    const events = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
      "focusin",
    ] as const;
    for (const event of events)
      window.addEventListener(event, revealControls, {
        capture: true,
        passive: true,
      });
    revealControls();
    return () => {
      clearTimeout(timeout);
      for (const event of events)
        window.removeEventListener(event, revealControls, true);
    };
  }, []);
  return readerIdle;
}
