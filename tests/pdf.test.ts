import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addMark, chunkText, createWelcome, deletePage, mergePdf, movePage, rotatePage } from '../src/pdf';

describe('PDF editing and export', () => {
  it('round-trips rotation, reordering, deletion and merging without changing the source', async () => {
    const original = await createWelcome();
    const rotated = await rotatePage(original, 0);
    expect((await PDFDocument.load(rotated)).getPage(0).getRotation().angle).toBe(90);
    const reordered = await movePage(rotated, 0, 1);
    const doc = await PDFDocument.load(reordered);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    const deleted = await deletePage(reordered, 1);
    expect((await PDFDocument.load(deleted)).getPageCount()).toBe(2);
    const merged = await mergePdf(deleted, original);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(5);
    expect((await PDFDocument.load(original)).getPage(0).getRotation().angle).toBe(0);
  });
  it('embeds text, highlight and drawing into a readable PDF', async () => {
    let data = await createWelcome();
    for (const type of ['text', 'highlight', 'pen'] as const) data = await addMark(data, 0, { type, text: 'Folio test note', points: [{ x: 50, y: 100 }, { x: 190, y: 120 }], size: 16, color: '#254f41', rotation: 0 });
    const result = await PDFDocument.load(data);
    expect(result.getPageCount()).toBe(3);
    expect(result.getPage(0).node.Contents()).toBeDefined();
  });
  it('prevents removing the last page', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    await expect(deletePage(await doc.save(), 0)).rejects.toThrow('at least one');
  });
  it('rejects invalid input instead of overwriting it', async () => { await expect(rotatePage(new Uint8Array([1,2,3]), 0)).rejects.toThrow(); });
});
describe('speech chunking', () => {
  it('preserves words while bounding generation requests', () => { const text = 'Reading a PDF should feel natural. '.repeat(60); const chunks = chunkText(text); expect(chunks.length).toBeGreaterThan(1); expect(chunks.every(c => c.length <= 450)).toBe(true); expect(chunks.join(' ')).toBe(text.trim()); });
  it('handles blank text and exceptionally long tokens', () => { expect(chunkText(' \n ')).toEqual([]); expect(chunkText('a'.repeat(1000)).map(c => c.length)).toEqual([450,450,100]); });
});
