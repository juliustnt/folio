const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { readFile, writeFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library } = require('./library.cjs');
const library = new Library(app.getPath('userData'));
const { SpeechWorker } = require('./speech.cjs');
const root = path.join(__dirname, '..');
const speech = new SpeechWorker(app.isPackaged ? process.resourcesPath : root);
const { launchFiles, PdfSources } = require('./latex.cjs');
const sources = new PdfSources();
let win; let dirty = false;
const pendingPdfs = launchFiles(process.argv, process.cwd());
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', (_event, argv, cwd) => {
  pendingPdfs.push(...launchFiles(argv, cwd));
  if (win && !win.isDestroyed()) { win.webContents.send('pdf:pending'); }
  else if (app.isReady()) createWindow();
});
app.on('open-file', (event, filename) => {
  event.preventDefault();
  pendingPdfs.push({ filename, latex: process.argv.includes('--latex') });
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send('pdf:pending');
  } else if (app.isReady()) createWindow();
});
const dev = process.argv.includes('--dev');
const appUrl = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(root, 'dist', 'index.html')).href;
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== appUrl) throw new Error('Untrusted caller'); }
function handle(channel, callback) { ipcMain.handle(channel, (event, ...args) => { trusted(event); return callback(...args); }); }
handle('pdf:default', async () => {
  if (process.platform !== 'darwin' || !app.isPackaged) throw new Error('Open the packaged Folio app to change the default PDF app.');
  const { setDefaultPdfApp } = require('./pdf-associations.cjs');
  await setDefaultPdfApp(process.resourcesPath, path.resolve(process.resourcesPath, '..', '..'));
});
handle('pdf:repair', async () => {
  if (process.platform !== 'darwin') throw new Error('Finder repair is available on macOS.');
  const result = await dialog.showOpenDialog(win, {
    title: 'Repair Finder opening',
    message: 'Choose a PDF to reset its individual Open With override. It will use your default PDF app; quarantine is preserved.',
    buttonLabel: 'Repair opening',
    properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const { repairPdfAssociation } = require('./pdf-associations.cjs');
  return { name: path.basename(result.filePaths[0]), repaired: await repairPdfAssociation(result.filePaths[0]) };
});
handle('pdf:next', async () => {
  const request = pendingPdfs.shift();
  if (!request) return null;
  const { filename, latex } = request;
  const file = await sources.open(filename, latex);
  await library.remember(filename);
  return file;
});
handle('pdf:open', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }); if (result.canceled) return null; const filename = result.filePaths[0]; const file = await sources.open(filename); await library.remember(filename); return file; });
handle('pdf:save', async (name, data) => { if (typeof name !== 'string' || !(data instanceof Uint8Array) || data.length > 512 * 1024 * 1024) throw new Error('Invalid PDF data.'); const result = await dialog.showSaveDialog(win, { defaultPath: path.basename(name), filters: [{ name: 'PDF documents', extensions: ['pdf'] }] }); if (result.canceled || !result.filePath) return false; await writeFile(result.filePath, data); await library.remember(result.filePath); return true; });
handle('library:recents', async () => (await library.read()).recents);
handle('library:open', async id => {
  const item = (await library.read()).recents.find(item => item.id === id);
  if (!item) throw new Error('This recent file is no longer in your library.');
  const file = await sources.open(item.path); await library.remember(item.path); return file;
});
handle('pdf:reload', (source, version) => sources.reload(source, version));
handle('library:remove', id => library.removeRecent(id));
handle('voice:remove', id => library.removeVoice(id));
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
  win = new BrowserWindow({ width: 1360, height: 920, minWidth: 820, minHeight: 620, title: 'Folio', icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'folio.ico' : 'folio.png'), backgroundColor: '#f8faf5', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => { if (dirty) { const response = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0, message: 'Close without saving your changes?', detail: 'Use Save a copy to keep your edits.' }); if (response === 0) { event.preventDefault(); return; } dirty = false; win.webContents.removeAllListeners('will-prevent-unload'); win.webContents.on('will-prevent-unload', e => e.preventDefault()); } speech.stop(); });
  win.loadURL(appUrl);
}
app.whenReady().then(() => {
  if (!primaryInstance) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Folio', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(dev ? [{ role: 'toggleDevTools' }] : [])] }, { role: 'windowMenu' }]));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { speech.stop(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => speech.stop());
