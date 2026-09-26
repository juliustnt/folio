import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rename, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { PdfSources, launchFiles } = createRequire(import.meta.url)('../electron/latex.cjs');
it('resolves launch paths and enables explicit LaTeX mode', () => {
  expect(launchFiles(['electron', '.', '--latex', 'a b.PDF'], '/work')).toEqual([{ filename: '/work/a b.PDF', latex: true }]);
  expect(launchFiles(['a.pdf'], '/work')[0].latex).toBe(false);
});
it('detects SyncTeX and reloads replacement files, retrying missing and active writes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'folio-latex-'));
  try {
    const filename = path.join(dir, 'paper.pdf');
    await writeFile(filename, 'first');
    await writeFile(path.join(dir, 'paper.synctex.gz'), '');
    const sources = new PdfSources();
    const initial = await sources.open(filename);
    expect(initial.latex).toBe(true);
    const settle = () => utimes(filename, new Date(0), new Date(0));
    await settle();
    expect(await sources.reload(initial.source, initial.version)).toBeNull();
    await rm(filename);
    expect(await sources.reload(initial.source, initial.version)).toBeNull();
    await writeFile(filename + '.tmp', 'second');
    await rename(filename + '.tmp', filename);
    expect(await sources.reload(initial.source, initial.version)).toBeNull();
    await settle();
    const update = await sources.reload(initial.source, initial.version);
    expect(Buffer.from(update.data).toString()).toBe('second');
    // Only the renderer acknowledges a successfully parsed version.
    expect(await sources.reload(initial.source, initial.version)).not.toBeNull();
    expect(await sources.reload(initial.source, update.version)).toBeNull();
    await expect(sources.reload('/arbitrary/path', '')).rejects.toThrow('Reopen');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
