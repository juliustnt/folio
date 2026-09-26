const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library } = require('./library.cjs');
const library = new Library(app.getPath('userData'));
const { SpeechWorker } = require('./speech.cjs');
const root = path.join(__dirname, '..');
const speech = new SpeechWorker(app.isPackaged ? process.resourcesPath : root);
const { launchFiles, PdfSources } = require('./latex.cjs');
const sources = new PdfSources();
const { createTrustedIpc } = require('./ipc.cjs');
const { registerPdfHandlers } = require('./handlers/pdf.cjs');
const { registerVoiceHandlers } = require('./handlers/voice.cjs');

let win;
let dirty = false;
const pendingPdfs = launchFiles(process.argv, process.cwd());
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on('second-instance', (_event, argv, cwd) => {
  pendingPdfs.push(...launchFiles(argv, cwd));
  if (win && !win.isDestroyed()) {
    win.webContents.send('pdf:pending');
  } else if (app.isReady()) {
    createWindow();
  }
});
app.on('open-file', (event, filename) => {
  event.preventDefault();
  pendingPdfs.push({ filename, latex: process.argv.includes('--latex') });
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('pdf:pending');
  } else if (app.isReady()) {
    createWindow();
  }
});

const dev = process.argv.includes('--dev');
const appUrl = dev
  ? 'http://127.0.0.1:5173/'
  : pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const getWindow = () => win;
const { trusted, handle } = createTrustedIpc(ipcMain, getWindow, appUrl);
registerPdfHandlers({ handle, app, dialog, getWindow, sources, library, pendingPdfs });
registerVoiceHandlers({ handle, dialog, getWindow, library, speech });
ipcMain.on('document:dirty', (event, value) => {
  trusted(event);
  dirty = !!value;
  win.setDocumentEdited(dirty);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 820,
    minHeight: 620,
    title: 'Folio',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'folio.ico' : 'folio.png'),
    backgroundColor: '#f8faf5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => {
    if (dirty) {
      const response = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Keep editing', 'Discard changes'],
        defaultId: 0,
        cancelId: 0,
        message: 'Close without saving your changes?',
        detail: 'Use Save a copy to keep your edits.',
      });
      if (response === 0) {
        event.preventDefault();
        return;
      }
      dirty = false;
      win.webContents.removeAllListeners('will-prevent-unload');
      win.webContents.on('will-prevent-unload', event => event.preventDefault());
    }
    speech.stop();
  });
  win.loadURL(appUrl);
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Folio',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }, ...(dev ? [{ role: 'toggleDevTools' }] : [])],
    },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('window-all-closed', () => {
  speech.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => speech.stop());
