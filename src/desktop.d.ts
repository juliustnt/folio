import type { VoiceProfile } from "./voice";
export type DesktopPdf = { name: string; data: Uint8Array; source: string; version: string; latex: boolean };
declare global {
  interface Window {
    folio?: {
      reloadPdf(source: string, version: string): Promise<{ data: Uint8Array; version: string } | null>;
      macOS: boolean;
      setDefaultPdfApp(): Promise<void>;
      repairPdfOpening(): Promise<{ name: string; repaired: boolean } | null>;
      recents(): Promise<
        { id: string; name: string; path: string; openedAt: string }[]
      >;
      openRecent(id: string): Promise<DesktopPdf>;
      removeRecent(id: string): Promise<void>;
      removeVoice(id: string): Promise<void>;
      nextPdf(): Promise<DesktopPdf | null>;
      onPendingPdf(callback: () => void): () => void;
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
      openPdf(): Promise<DesktopPdf | null>;
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
