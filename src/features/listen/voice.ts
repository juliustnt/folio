export type VoiceProfile = {
  id: string;
  name: string;
  transcript: string;
  start?: number;
  end?: number;
  duration?: number;
};
export function speechError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
}
