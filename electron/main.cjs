const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { readFile, writeFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library } = require('./library.cjs');
const library = new Library(app.getPath('userData'));
const { SpeechWorker } = require('./speech.cjs');
const root = path.join(__dirname, '..');
const speech = new SpeechWorker(app.isPackaged ? process.resourcesPath : root);
let win; let dirty = false;
const dev = process.argv.includes('--dev');
const appUrl = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(root, 'dist', 'index.html')).href;
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== appUrl) throw new Error('Untrusted caller'); }
function handle(channel, callback) { ipcMain.handle(channel, (event, ...args) => { trusted(event); return callback(...args); }); }
handle('pdf:open', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }); if (result.canceled) return null; const filename = result.filePaths[0]; const data = new Uint8Array(await readFile(filename)); await library.remember(filename); return { name: path.basename(filename), data }; });
handle('pdf:save', async (name, data) => { if (typeof name !== 'string' || !(data instanceof Uint8Array) || data.length > 512 * 1024 * 1024) throw new Error('Invalid PDF data.'); const result = await dialog.showSaveDialog(win, { defaultPath: path.basename(name), filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }); if (result.canceled || !result.filePath) return false; await writeFile(result.filePath, data); await library.remember(result.filePath); return true; });
handle('library:recents', async () => (await library.read()).recents);
handle('library:open', id => library.openRecent(id));
handle('voice:list', () => library.voices());
handle('voice:inspect', async id => {
  const saved = await library.reference(id); const source = voiceReferences.get(id) || saved?.path;
  if (!source) throw new Error('Choose a recording first.');
  const info = await speech.inspectReference(source);
  const extension = path.extname(source).toLowerCase();
  return { ...info, audio: (await readFile(source)).toString('base64'), mime: extension === '.mp3' ? 'audio/mpeg' : extension === '.flac' ? 'audio/flac' : 'audio/wav' };
});
handle('voice:save', async ({ id, name, transcript, start, end }) => {
  const saved = await library.reference(id); const source = voiceReferences.get(id) || saved?.path;
  if (!source) throw new Error('Choose a recording first.');
  const info = await speech.inspectReference(source, { start, end });
  return library.saveVoice(source, name, transcript, { start: start || 0, end: end ?? info.duration, duration: info.duration }, saved?.id);
});
handle('tts:status', () => speech.status());
const voiceReferences = new Map();
handle('voice:choose', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Voice reference', extensions: ['mp3', 'wav', 'flac'] }] });
  if (result.canceled) return null;
  const filename = result.filePaths[0];
  if ((await stat(filename)).size > 20 * 1024 * 1024) throw new Error('Choose a voice sample smaller than 20 MB.');
  const info = await speech.inspectReference(filename);
  if (info.duration < 3) throw new Error(`This recording is ${info.duration.toFixed(1)} seconds long. Choose at least 3 seconds of speech.`);
  const id = require('node:crypto').randomUUID(); voiceReferences.set(id, filename);
  return { id, name: path.basename(filename) };
});
handle('tts:speak', async request => {
  if (!request || typeof request !== 'object') throw new Error('Invalid speech request.');
  let reference;
  if (request.voice === 'clone') {
    const saved = await library.reference(request.reference?.id);
    const path = saved?.path || voiceReferences.get(request.reference?.id);
    const transcript = saved?.transcript || request.reference?.transcript;
    if (!path || typeof transcript !== 'string' || !transcript.trim() || transcript.length > 2000) throw new Error('Choose a sample and enter its exact transcript.');
    reference = { path, transcript: transcript.trim(), start: saved?.start || 0, end: saved?.end };
  }
  return speech.speak({ text: request.text, voice: request.voice, language: request.language, reference });
});
handle('tts:stop', () => speech.stop());
ipcMain.on('document:dirty', (event, value) => { trusted(event); dirty = !!value; win.setDocumentEdited(dirty); });
function createWindow() {
  win = new BrowserWindow({ width: 1360, height: 920, minWidth: 820, minHeight: 620, title: 'Folio', backgroundColor: '#f8faf5', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => { if (dirty) { const response = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0, message: 'Close without saving your changes?', detail: 'Use Save a copy to keep your edits.' }); if (response === 0) { event.preventDefault(); return; } dirty = false; win.webContents.removeAllListeners('will-prevent-unload'); win.webContents.on('will-prevent-unload', e => e.preventDefault()); } speech.stop(); });
  win.loadURL(appUrl);
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Folio', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(dev ? [{ role: 'toggleDevTools' }] : [])] }, { role: 'windowMenu' }]));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { speech.stop(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => speech.stop());
