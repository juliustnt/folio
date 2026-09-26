export type ReadingHighlight = { page: number; start: number; end: number };

// Layout whitespace and line-end hyphens differ between speech and PDF spans.
export function readingKey(text: string): string {
  return text.replace(/[\s\-\u00ad]/g, "");
}

export function readingOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (readingKey(text[i])) offsets.push(i);
  }
  return offsets;
}
