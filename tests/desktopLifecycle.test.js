import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../electron/main.cjs', import.meta.url));
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

function desktop(primaryInstance = true) {
  const events = new Map();
  const ipcEvents = new Map();
  const windows = [];
  const stop = vi.fn();
  const dialog = { showMessageBoxSync: vi.fn() };
  let ready;
  const app = {
    getPath: () => '/fixture',
    requestSingleInstanceLock: () => primaryInstance,
    quit: vi.fn(),
    on: (name, callback) => events.set(name, callback),
    whenReady: () => ({ then: callback => { ready = callback; } }),
  };
  class Window {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.contentEvents = new Map();
      this.setDocumentEdited = vi.fn();
      this.webContents = {
        mainFrame: { url: '' },
        setWindowOpenHandler: vi.fn(),
        on: (name, callback) => this.contentEvents.set(name, callback),
        removeAllListeners: name => this.contentEvents.delete(name),
        session: { setPermissionRequestHandler: vi.fn() },
      };
      windows.push(this);
    }
    on(name, callback) { this.events.set(name, callback); }
    loadURL(url) { this.webContents.mainFrame.url = url; }
    static getAllWindows() { return windows; }
  }
  const context = {
    __dirname: '/folio/electron',
    process: { argv: [], cwd: () => '/fixture', platform: 'darwin' },
    require(name) {
      if (name === 'electron') return {
        app, BrowserWindow: Window, dialog,
        ipcMain: { handle() {}, on: (name, callback) => ipcEvents.set(name, callback) },
        Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
      };
      if (name === './library.cjs') return { Library: class {} };
      if (name === './speech.cjs') return { SpeechWorker: class { stop = stop; } };
      if (name === './latex.cjs') return { launchFiles: () => [], PdfSources: class {} };
      return require(name);
    },
  };
  vm.runInNewContext(source, context);
  ready();
  const window = windows[0];
  return {
    app, events, dialog, stop, windows, window,
    setDirty: value => ipcEvents.get('document:dirty')({
      sender: window.webContents, senderFrame: window.webContents.mainFrame,
    }, value),
  };
}

describe('desktop window lifecycle', () => {
  it('keeps editing without stopping speech when the close prompt is canceled', () => {
    const test = desktop();
    test.setDirty(true);
    test.dialog.showMessageBoxSync.mockReturnValue(0);
    const event = { preventDefault: vi.fn() };
    test.window.events.get('close')(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(test.stop).not.toHaveBeenCalled();
    expect(test.window.setDocumentEdited).toHaveBeenCalledWith(true);
    expect(test.dialog.showMessageBoxSync).toHaveBeenCalledWith(test.window, expect.objectContaining({ defaultId: 0, cancelId: 0 }));
  });

  it('discards only after confirmation and allows renderer unload', () => {
    const test = desktop();
    test.setDirty(true);
    test.dialog.showMessageBoxSync.mockReturnValue(1);
    const event = { preventDefault: vi.fn() };
    test.window.events.get('close')(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(test.stop).toHaveBeenCalledOnce();
    const unload = { preventDefault: vi.fn() };
    test.window.contentEvents.get('will-prevent-unload')(unload);
    expect(unload.preventDefault).toHaveBeenCalledOnce();
    test.window.events.get('close')(event);
    expect(test.dialog.showMessageBoxSync).toHaveBeenCalledOnce();
  });

  it('retains sandbox settings, navigation blocking and denied permissions', () => {
    const { window } = desktop();
    expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() };
    window.contentEvents.get('will-navigate')(event, 'https://outside.example');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    const allowed = vi.fn();
    window.webContents.session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', allowed);
    expect(allowed).toHaveBeenCalledWith(false);
  });

  it('quits a secondary instance without creating a window', () => {
    const test = desktop(false);
    expect(test.app.quit).toHaveBeenCalledOnce();
    expect(test.windows).toHaveLength(0);
  });
});
