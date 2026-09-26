import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createTrustedIpc } = require('../electron/ipc.cjs');
const { registerPdfHandlers } = require('../electron/handlers/pdf.cjs');
const { registerVoiceHandlers } = require('../electron/handlers/voice.cjs');
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-handlers-'));
  directories.push(directory);
  return directory;
}
function registry() {
  const handlers = new Map();
  return { handlers, handle: (channel, callback) => handlers.set(channel, callback) };
}

describe('desktop caller authorization', () => {
  function setup() {
    const { handlers, handle } = registry();
    let window = { webContents: { mainFrame: { url: 'file:///folio/index.html#reader' } } };
    const ipc = createTrustedIpc({ handle }, () => window, 'file:///folio/index.html');
    const callback = vi.fn(value => Promise.resolve(value));
    ipc.handle('test', callback);
    return {
      ipc, callback, invoke: handlers.get('test'), window,
      event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      replaceWindow: value => { window = value; },
    };
  }

  it('accepts only the current main frame and preserves callback arguments and results', async () => {
    const test = setup();
    await expect(test.invoke(test.event, 'result')).resolves.toBe('result');
    expect(test.callback).toHaveBeenCalledWith('result');
    test.replaceWindow({ webContents: { mainFrame: { url: 'file:///folio/index.html' } } });
    expect(() => test.invoke(test.event)).toThrow('Untrusted caller');
  });

  it.each(['missing-window', 'sender', 'subframe', 'url', 'query'])('rejects %s before invoking the handler', scenario => {
    const test = setup();
    if (scenario === 'missing-window') test.replaceWindow(undefined);
    if (scenario === 'sender') test.event.sender = {};
    if (scenario === 'subframe') test.event.senderFrame = { url: 'file:///folio/index.html' };
    if (scenario === 'url') test.event.senderFrame.url = 'https://untrusted.example/';
    if (scenario === 'query') test.event.senderFrame.url = 'file:///folio/index.html?unexpected';
    expect(() => test.invoke(test.event)).toThrow('Untrusted caller');
    expect(() => test.ipc.trusted(test.event)).toThrow('Untrusted caller');
    expect(test.callback).not.toHaveBeenCalled();
  });
});

describe('PDF handlers', () => {
  function setup() {
    const registrations = registry();
    const window = {};
    const library = { remember: vi.fn(), read: vi.fn(async () => ({ recents: [] })), removeRecent: vi.fn() };
    const sources = { open: vi.fn(), reload: vi.fn() };
    const dialog = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() };
    const pendingPdfs = [];
    registerPdfHandlers({ ...registrations, app: {}, dialog, getWindow: () => window, library, sources, pendingPdfs });
    return { ...registrations, window, library, sources, dialog, pendingPdfs };
  }

  it('does no file work when opening or saving is canceled', async () => {
    const test = setup();
    test.dialog.showOpenDialog.mockResolvedValue({ canceled: true });
    test.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await test.handlers.get('pdf:open')()).toBeNull();
    expect(await test.handlers.get('pdf:save')('test.pdf', new Uint8Array([1]))).toBe(false);
    expect(test.sources.open).not.toHaveBeenCalled();
    expect(test.library.remember).not.toHaveBeenCalled();
  });

  it('validates before showing a dialog and remembers only after the copy is written', async () => {
    const test = setup();
    await expect(test.handlers.get('pdf:save')(null, new Uint8Array())).rejects.toThrow('Invalid PDF data.');
    await expect(test.handlers.get('pdf:save')('test.pdf', [1])).rejects.toThrow('Invalid PDF data.');
    expect(test.dialog.showSaveDialog).not.toHaveBeenCalled();
    const filename = path.join(await temporaryDirectory(), 'copy.pdf');
    const bytes = new Uint8Array([37, 80, 68, 70]);
    test.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: filename });
    test.library.remember.mockImplementation(async saved => {
      expect(saved).toBe(filename);
      expect(new Uint8Array(await readFile(saved))).toEqual(bytes);
    });
    expect(await test.handlers.get('pdf:save')('/original/name.pdf', bytes)).toBe(true);
    expect(test.dialog.showSaveDialog).toHaveBeenCalledWith(test.window, expect.objectContaining({ defaultPath: 'name.pdf' }));
    expect(test.library.remember).toHaveBeenCalledOnce();
  });

  it('consumes a failed queued open once and can continue to the following request', async () => {
    const test = setup();
    test.pendingPdfs.push({ filename: '/bad.pdf', latex: true }, { filename: '/good.pdf', latex: false });
    test.sources.open.mockRejectedValueOnce(new Error('Unreadable')).mockResolvedValueOnce({ name: 'good.pdf' });
    await expect(test.handlers.get('pdf:next')()).rejects.toThrow('Unreadable');
    expect(await test.handlers.get('pdf:next')()).toEqual({ name: 'good.pdf' });
    expect(await test.handlers.get('pdf:next')()).toBeNull();
    expect(test.sources.open.mock.calls).toEqual([['/bad.pdf', true], ['/good.pdf', false]]);
    expect(test.library.remember.mock.calls).toEqual([['/good.pdf']]);
  });

  it('rejects unknown recent IDs and forwards opaque reload capabilities unchanged', async () => {
    const test = setup();
    await expect(test.handlers.get('library:open')('/arbitrary/path.pdf')).rejects.toThrow('no longer in your library');
    expect(test.sources.open).not.toHaveBeenCalled();
    test.sources.reload.mockResolvedValue(null);
    expect(await test.handlers.get('pdf:reload')('opaque-id', 'version')).toBeNull();
    expect(test.sources.reload).toHaveBeenCalledWith('opaque-id', 'version');
  });
});

describe('voice reference handlers', () => {
  function setup() {
    const registrations = registry();
    const dialog = { showOpenDialog: vi.fn() };
    const library = { reference: vi.fn(async () => undefined), saveVoice: vi.fn() };
    const speech = { inspectReference: vi.fn(async () => ({ duration: 12 })), speak: vi.fn(async () => ({ audio: 'audio' })) };
    registerVoiceHandlers({ ...registrations, dialog, getWindow: () => ({}), library, speech });
    return { ...registrations, dialog, library, speech };
  }

  it('rejects renderer paths and only exposes a picked recording through its opaque ID', async () => {
    const test = setup();
    const filename = path.join(await temporaryDirectory(), 'sample.wav');
    await writeFile(filename, 'synthetic recording');
    await expect(test.handlers.get('voice:inspect')(filename)).rejects.toThrow('Choose a recording first.');
    expect(test.speech.inspectReference).not.toHaveBeenCalled();
    test.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filename] });
    const chosen = await test.handlers.get('voice:choose')();
    expect(chosen.id).not.toBe(filename);
    expect(await test.handlers.get('voice:inspect')(chosen.id)).toEqual({
      duration: 12, mime: 'audio/wav', audio: Buffer.from('synthetic recording').toString('base64'),
    });
    await test.handlers.get('voice:save')({ id: chosen.id, name: 'Voice', transcript: 'Words', start: 0 });
    expect(test.library.saveVoice).toHaveBeenCalledWith(filename, 'Voice', 'Words', { start: 0, end: 12, duration: 12 }, undefined);
  });

  it('uses the saved transcript and segment for synthesis instead of renderer overrides', async () => {
    const test = setup();
    test.library.reference.mockResolvedValue({ id: 'saved', path: '/saved.wav', transcript: ' Saved words ', start: 4, end: 9 });
    await test.handlers.get('tts:speak')({ text: 'Read me', voice: 'clone', language: 'English', reference: { id: 'saved', transcript: 'Override' } });
    expect(test.speech.speak).toHaveBeenCalledWith({
      text: 'Read me', voice: 'clone', language: 'English',
      reference: { path: '/saved.wav', transcript: 'Saved words', start: 4, end: 9 },
    });
  });

  it('does not synthesize when a clone reference is unknown', async () => {
    const test = setup();
    await expect(test.handlers.get('tts:speak')({ voice: 'clone', reference: { id: '/unknown.wav', transcript: 'Words' } })).rejects.toThrow('Choose a sample');
    expect(test.speech.speak).not.toHaveBeenCalled();
  });
});
