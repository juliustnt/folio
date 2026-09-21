import type { VoiceProfile } from "./voice";
export {};
declare global {
  interface Window {
    folio?: {
      recents(): Promise<
        { id: string; name: string; path: string; openedAt: string }[]
      >;
      openRecent(id: string): Promise<{ name: string; data: Uint8Array }>;
      voices(): Promise<VoiceProfile[]>;
      inspectVoice(
        id: string,
      ): Promise<{ duration: number; audio: string; mime: string }>;
      saveVoice(profile: {
        id: string;
        name: string;
        transcript: string;
        start: number;
        end: number;
      }): Promise<VoiceProfile>;
      openPdf(): Promise<{ name: string; data: Uint8Array } | null>;
      savePdf(name: string, data: Uint8Array): Promise<boolean>;
      ttsStatus(): Promise<{ available: boolean; message: string }>;
      chooseVoice(): Promise<{ id: string; name: string } | null>;
      speak(
        text: string,
        voice: string,
        language: string,
        reference?: { id: string; transcript: string },
      ): Promise<{ audio: string }>;
      stopSpeech(): Promise<void>;
      setDirty(dirty: boolean): void;
    };
  }
}
