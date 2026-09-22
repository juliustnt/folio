import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { Library } = createRequire(import.meta.url)('../electron/library.cjs');
describe('on-disk library', () => {
  it('copies voice audio and restores profiles after restarting without the original sample', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-library-test-'));
    try {
      const source = path.join(directory, 'reference.mp3'); await writeFile(source, 'synthetic test recording');
      const library = new Library(path.join(directory, 'data'));
      const voice = await library.saveVoice(source, 'My saved voice', 'Exact sample words.');
      await rm(source);
      const restarted = new Library(path.join(directory, 'data'));
      expect(await restarted.voices()).toEqual([{ ...voice }]);
      const ref = await restarted.reference(voice.id);
      expect(await readFile(ref.path, 'utf8')).toBe('synthetic test recording');
      expect(ref.transcript).toBe('Exact sample words.');
    } finally { await rm(directory, { recursive: true }); }
  });
  it('removes recents persistently while preserving files and other entries', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-remove-recent-'));
    try {
      const file = path.join(directory, 'test.pdf');
      await writeFile(file, 'test pdf bytes');
      const library = new Library(path.join(directory, 'data'));
      const removed = await library.remember(file);
      const kept = await library.remember(path.join(directory, 'other.pdf'));
      await library.removeRecent(removed.id);
      const restarted = new Library(path.join(directory, 'data'));
      expect((await restarted.read()).recents).toEqual([kept]);
      expect(await readFile(file, 'utf8')).toBe('test pdf bytes');
      await expect(restarted.openRecent(removed.id)).rejects.toThrow('no longer');
      await restarted.removeRecent(removed.id);
      expect((await restarted.read()).recents).toEqual([kept]);
      await restarted.removeRecent(kept.id);
      expect((await restarted.read()).recents).toEqual([]);
      await restarted.remember(file);
      expect((await restarted.read()).recents).toHaveLength(1);
    } finally { await rm(directory, { recursive: true }); }
  });
  it('persists recents and restricts reopening to known IDs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-recents-test-'));
    try {
      const file = path.join(directory, 'test.pdf'); await writeFile(file, 'test pdf bytes');
      const library = new Library(path.join(directory, 'data'));
      const [a, b] = await Promise.all([library.remember(file), library.remember(file)]);
      expect(a.id).toBe(b.id);
      const restarted = new Library(path.join(directory, 'data'));
      expect((await restarted.read()).recents).toHaveLength(1);
      expect((await restarted.openRecent(a.id)).name).toBe('test.pdf');
      await expect(restarted.openRecent('/etc/passwd')).rejects.toThrow('no longer');
    } finally { await rm(directory, { recursive: true }); }
  });
});

describe('editing saved voice segments', () => {
  it('updates the same saved profile with the selected range and transcript', async () => {
    const directory=await mkdtemp(path.join(tmpdir(),'folio-voice-edit-test-'));
    try {
      const source=path.join(directory,'source.wav'); await writeFile(source,'synthetic source bytes');
      const store=new Library(path.join(directory,'data'));
      const voice=await store.saveVoice(source,'Test','Full transcript');
      const existing=await store.reference(voice.id);
      await store.saveVoice(existing.path,'Repaired voice','Segment transcript',{start:10,end:22,duration:74},voice.id);
      const restarted=new Library(path.join(directory,'data'));
      expect(await restarted.voices()).toEqual([{id:voice.id,name:'Repaired voice',transcript:'Segment transcript',start:10,end:22,duration:74}]);
      expect(await readFile((await restarted.reference(voice.id)).path,'utf8')).toBe('synthetic source bytes');
    } finally { await rm(directory,{recursive:true}); }
  });
});

describe('removing custom voices', () => {
  it('removes the saved profile and copied audio, preserving originals and other voices', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-remove-voice-'));
    try {
      const source = path.join(directory, 'original.wav');
      await writeFile(source, 'original audio');
      const library = new Library(path.join(directory, 'data'));
      const removed = await library.saveVoice(source, 'Remove me', 'Sample words');
      const kept = await library.saveVoice(source, 'Keep me', 'Sample words');
      const recording = await library.reference(removed.id);
      await library.removeVoice(removed.id);
      const restarted = new Library(path.join(directory, 'data'));
      expect(await restarted.voices()).toEqual([kept]);
      expect(await restarted.reference(removed.id)).toBeUndefined();
      await expect(readFile(recording.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(source, 'utf8')).toBe('original audio');
      await expect(restarted.removeVoice(source)).rejects.toThrow('not found');
      expect(await restarted.voices()).toEqual([kept]);
    } finally { await rm(directory, { recursive: true }); }
  });
});
