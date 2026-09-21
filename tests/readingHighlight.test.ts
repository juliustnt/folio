import { describe, expect, it } from "vitest";
import { readingKey, readingOffsets } from "../src/readingHighlight";
import { readingPassages } from "../src/speech";

describe("reading highlight text mapping", () => {
  it("maps spoken text back to PDF characters across wrapping and hyphenation", () => {
    const pdfText = "A long para-\ngraph with soft\u00adhyphens.";
    const spoken = readingPassages(pdfText)[0].text;
    const key = readingKey(spoken);
    const start = readingKey(pdfText).indexOf(key);
    const offsets = readingOffsets(pdfText);
    expect(start).toBe(0);
    expect(pdfText.slice(offsets[start], offsets[start + key.length - 1] + 1)).toBe(pdfText);
  });

  it("advances past repeated passages instead of highlighting their first occurrence", () => {
    const source = "Same words.\n\nSame words.";
    let cursor = 0;
    const starts = readingPassages(source).map(passage => {
      const key = readingKey(passage.text);
      const start = readingKey(source).indexOf(key, cursor);
      cursor = start + key.length;
      return start;
    });
    expect(starts).toEqual([0, 10]);
  });

  it("keeps UTF-16 offsets for multilingual text and ignores empty layout spans", () => {
    const text = " 你好 😀 ";
    const offsets = readingOffsets(text);
    expect(text.slice(offsets[0], offsets.at(-1)! + 1)).toBe("你好 😀");
    expect(readingOffsets(" \n\t")).toEqual([]);
  });
});
