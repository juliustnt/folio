import { describe, it, expect } from 'vitest';
import { documentPassages } from '../src/speech';
import { remapBookmarks } from '../src/preferences';
import { readContents } from '../src/Contents';
import type { PDFDocumentProxy } from 'pdfjs-dist';
describe('continuous reading', () => {
  it('queues future pages in order and skips empty pages', () => { const plan = documentPassages(['First.','', 'Third.\n\nMore.'], 1, true); expect(plan.map(p => p.page)).toEqual([1,3,3]); expect(plan.map(p => p.text)).toEqual(['First.','Third.','More.']); });
  it('respects single-page mode and starts at the current page', () => { expect(documentPassages(['One.','Two.','Three.'],2,false).map(p=>p.text)).toEqual(['Two.']); expect(documentPassages(['One.','Two.','Three.'],2,true).map(p=>p.page)).toEqual([2,3]); });
  it('limits selected-text reading to the selection', () => { expect(documentPassages(['One.','Two.'],1,true,'Selected text.').map(p=>p.text)).toEqual(['Selected text.']); });
});
describe('bookmarks and contents', () => {
  const marks = [1,2,3,4].map(page => ({ id: String(page), title: `Page ${page}`, page }));
  it('moves bookmarks with their pages', () => { expect(remapBookmarks(marks,2,4).map(b=>b.page)).toEqual([1,4,2,3]); expect(remapBookmarks(marks,4,2).map(b=>b.page)).toEqual([1,3,4,2]); });
  it('removes deleted-page bookmarks and shifts following pages', () => { expect(remapBookmarks(marks,2).map(b=>b.page)).toEqual([1,2,3]); expect(marks[1].page).toBe(2); });
  it('resolves nested and named PDF outline destinations', async () => {
    const pdf = { getOutline: async () => [{ title: 'Chapter', dest:'chapter', items:[{title:'Section',dest:[2],items:[]}] }], getDestination:async()=>[{num:10,gen:0}], getPageIndex:async()=>0 } as unknown as PDFDocumentProxy;
    expect(await readContents(pdf)).toEqual([{title:'Chapter',page:1,depth:0},{title:'Section',page:3,depth:1}]);
  });
});
