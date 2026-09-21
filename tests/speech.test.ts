import { describe, it, expect } from 'vitest';
import { extractReadingText, readingPassages, SpeechQueue } from '../src/speech';
const line = (str: string, y: number, x = 50) => ({ str, transform: [12,0,0,12,x,y], width: 200, height: 12, hasEOL: true });
describe('paragraph reading', () => {
  it('joins wrapped lines, removes line-end hyphenation, preserves paragraphs', () => {
    const result = readingPassages('A long para-\ngraph continues\non this line.\n\nA second paragraph.');
    expect(result.map(p => p.text)).toEqual(['A long paragraph continues on this line.', 'A second paragraph.']);
    expect(result.map(p => p.paragraph)).toEqual([1,2]);
  });
  it('infers paragraph gaps from PDF geometry rather than every line ending', () => {
    const result = readingPassages(extractReadingText([line('First line',700),line('continues here.',682),line('Another paragraph.',646)]));
    expect(result.map(p=>p.text)).toEqual(['First line continues here.','Another paragraph.']);
  });
  it('splits long paragraphs at sentences and keeps their paragraph identity', () => {
    const result = readingPassages('One sentence. Another sentence. Final sentence.\n\nNext paragraph.',30);
    expect(result.map(p=>p.text)).toEqual(['One sentence.','Another sentence.','Final sentence.','Next paragraph.']);
    expect(result.map(p=>p.paragraph)).toEqual([1,1,1,2]);
    expect(result[0].parts).toBe(3);
  });
  it('preserves decimals and abbreviations', () => { expect(readingPassages('Dr. Smith measured 3.14 units. Then continued.')[0].text).toBe('Dr. Smith measured 3.14 units. Then continued.'); });
  it('bounds overlong words and handles empty text', () => { expect(readingPassages(' \n ')).toEqual([]); expect(readingPassages('x'.repeat(1000)).every(p=>p.text.length<=450)).toBe(true); });
});
describe('lookahead generation', () => {
  it('prepares future passages in order with only one active model request', async () => {
    let active = 0; let maximum = 0; const calls: string[] = [];
    const queue = new SpeechQueue(readingPassages('First.\n\nSecond.\n\nThird.'), async text => { active++; maximum=Math.max(maximum,active); calls.push(text); await Promise.resolve(); active--; return text; });
    queue.prepareThrough(1);
    expect(await queue.get(1)).toBe('Second.');
    expect(calls).toEqual(['First.','Second.']);
    expect(await queue.get(0)).toBe('First.');
    queue.release(0); queue.prepareThrough(2);
    expect(await queue.get(2)).toBe('Third.'); expect(maximum).toBe(1);
  });
  it('retains prefetch errors until consumed without rejecting the background queue', async () => {
    const queue = new SpeechQueue(readingPassages('First.\n\nSecond.'), async text => { if(text==='Second.') throw new Error('model failed'); return text; });
    queue.prepareThrough(1); expect(await queue.get(0)).toBe('First.'); await expect(queue.get(1)).rejects.toThrow('model failed');
  });
  it('cancels queued generation and suppresses stale results', async () => {
    let release!: (value: string) => void; const calls: string[] = [];
    const queue = new SpeechQueue(readingPassages('First.\n\nSecond.'), text => { calls.push(text); return new Promise<string>(resolve => { release=resolve; }); });
    queue.prepareThrough(1); const first=queue.get(0); await Promise.resolve(); queue.cancel(); release('audio');
    await expect(first).rejects.toThrow('stopped'); expect(calls).toEqual(['First.']);
  });
});
