import { chunkText } from "./pdf";

type TextItem = {
  str: string;
  transform: number[];
  height: number;
  width: number;
  hasEOL: boolean;
};
/** PDF line breaks are layout, not speech breaks. Infer paragraphs from spacing and indentation. */
export function extractReadingText(items: unknown[]): string {
  const lines: { text: string; x: number; y: number; height: number }[] = [];
  let line: (typeof lines)[number] | undefined;
  for (const raw of items) {
    const item = raw as Partial<TextItem>;
    if (typeof item.str !== "string" || !item.transform) continue;
    const x = item.transform[4],
      y = item.transform[5],
      height = Math.abs(item.height || item.transform[3] || 12);
    if (line && Math.abs(y - line.y) > Math.max(2, line.height * 0.45)) {
      lines.push(line);
      line = undefined;
    }
    if (!line) line = { text: "", x, y, height };
    line.text +=
      (line.text && item.str && !/\s$/.test(line.text) ? " " : "") + item.str;
    if (item.hasEOL) {
      if (line.text.trim()) lines.push(line);
      line = undefined;
    }
  }
  if (line?.text.trim()) lines.push(line);
  let output = "";
  lines.forEach((current, i) => {
    const previous = lines[i - 1];
    const gap = previous ? previous.y - current.y : 0;
    const paragraph =
      previous &&
      (gap > Math.max(previous.height, current.height) * 1.9 ||
        gap < -current.height ||
        Math.abs(current.height - previous.height) > 2 ||
        (current.x > previous.x + current.height &&
          /[.!?]["”']?$/.test(previous.text.trim())));
    output += (i ? (paragraph ? "\n\n" : "\n") : "") + current.text.trim();
  });
  return output;
}
export type Passage = {
  text: string;
  paragraph: number;
  part: number;
  parts: number;
};
export function readingPassages(text: string, limit = 450): Passage[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[\t ]*\n+/)
    .map((p) =>
      p
        .replace(/([\p{L}])[-\u00ad]\n[\t ]*(?=[\p{Ll}])/gu, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return paragraphs.flatMap((paragraph, index) => {
    const sentences = [
      ...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(
        paragraph,
      ),
    ].map((item) => item.segment);
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      for (const section of chunkText(sentence, limit)) {
        if (current && current.length + section.length + 1 > limit) {
          chunks.push(current);
          current = "";
        }
        current += (current ? " " : "") + section;
      }
    }
    if (current) chunks.push(current);
    return chunks.map((value, part) => ({
      text: value,
      paragraph: index + 1,
      part: part + 1,
      parts: chunks.length,
    }));
  });
}
/** Serial generation with bounded lookahead. Rejections are stored, never left unhandled. */
export class SpeechQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private entries = new Map<
    number,
    Promise<{ value: T } | { error: unknown }>
  >();
  private next = 0;
  private cancelled = false;
  constructor(
    private passages: Passage[],
    private generate: (text: string) => Promise<T>,
    private ready: (index: number) => void = () => {},
  ) {}
  prepareThrough(index: number) {
    while (
      !this.cancelled &&
      this.next <= Math.min(index, this.passages.length - 1)
    ) {
      const n = this.next++;
      const pending = this.tail.then(async () => {
        if (this.cancelled) return { error: new Error("Reading stopped.") };
        try {
          const value = await this.generate(this.passages[n].text);
          if (!this.cancelled) this.ready(n);
          return { value };
        } catch (error) {
          return { error };
        }
      });
      this.entries.set(n, pending);
      this.tail = pending.then(() => {});
    }
  }
  async get(index: number): Promise<T> {
    this.prepareThrough(index);
    const result = await this.entries.get(index);
    if (this.cancelled || !result) throw new Error("Reading stopped.");
    if ("error" in result) throw result.error;
    return result.value;
  }
  release(index: number) {
    this.entries.delete(index);
  }
  cancel() {
    this.cancelled = true;
    this.entries.clear();
  }
}

/** Build one queue across page boundaries; image-only pages have no spoken passages. */
export function documentPassages(
  texts: string[],
  startPage: number,
  continuePages: boolean,
  selection = "",
) {
  if (selection.trim())
    return readingPassages(selection).map((p) => ({ ...p, page: startPage }));
  return texts
    .slice(startPage - 1, continuePages ? undefined : startPage)
    .flatMap((text, index) =>
      readingPassages(text).map((p) => ({ ...p, page: startPage + index })),
    );
}
