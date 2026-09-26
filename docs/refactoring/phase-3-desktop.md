# Phase 3: Desktop boundaries and remaining workspace JSX

## Outcome

Phase 3 is complete. The planned three-phase refactor is now complete, with the validation limits below. Existing focused modules outside these phases remain in place; completion does not imply every source file needed rewriting.

The README and Phase 1/2 reports guided this phase. Desktop handlers are separated by responsibility behind the existing caller check; worker and library control flow is readable; the remaining bookmark dialog and LaTeX controls are module-level components. No functionality changes were intended.

## Analysis before editing

Three weaknesses were identified for this unit:

1. The desktop entry point combined lifecycle, caller authorization, PDF dialogs and voice operations, obscuring responsibility boundaries.
2. Compressed worker/storage statements obscured operation order, cleanup and intentional recovery policies.
3. The bookmark dialog and LaTeX controls still occupied substantial inline JSX in App.

The three immediate improvements were extracting domain handlers behind a shared trust wrapper, expanding worker/storage control flow without changing policies, and extracting those JSX sections without new DOM wrappers or callback semantics.

## Behavior-preservation decisions

- All 17 invoke channels retain their names and registration order. The preload bridge remains unchanged.
- Caller checks still require the current window's web contents, its main frame and the expected URL. Dirty notifications use the same check.
- Native file opens, queued requests, saves and library remembering retain their original sequence and cancellation results.
- The temporary voice map is created once at registration and survives window recreation. Saved and temporary reference priority is preserved separately for each operation.
- Speech request validation, timeout, process lifetime and stale-exit protection retain their original behavior. Inspector validation text and parse fallback are preserved.
- The library still serializes mutations and writes through a temporary JSON file followed by rename. A rejected operation releases only the queue; its caller still receives the failure.
- No new global error suppression or user-facing messages were added. Existing intentional fallbacks are documented.
- The JSX components are declared at module scope and add no state, effects or DOM wrappers. Parent visibility gates and document mutation ownership remain in App.
- Existing promise chains that implement lifecycle or serialization were retained. Converting them solely for style could change sequencing.

## Validation

### Permanent tests and build

- Baseline: all 38 existing tests and the production build passed.
- Final permanent suite: **63 tests passed across 12 files** (the original 38 plus 25 new desktop/storage regressions).
- The six new worker tests and four new lifecycle tests also passed against saved copies of the original worker and main process. Their source paths were restored before the final run.
- Final production build passed, including strict TypeScript and recursive syntax checks for desktop CommonJS modules.
- Python reference validation passed: **6 tests**, using the README's unittest command in the existing virtual environment.
- `git diff --check` passed.
- Source inspection confirmed all 17 invoke registrations retain their original names/order.
- The existing large-bundle build warning remains.

### JSX comparison

A temporary comparison used the exact pre-refactor JSX alongside the extracted components and parent action:

- Six bookmark cases cover new/existing IDs and empty/whitespace/trimmed names. Rendered HTML and submit/change/cancel callback traces matched.
- Thirty-two LaTeX cases cover source availability, feature visibility, on/off mode, dirty state and reload messages. Rendered HTML and toggle callback traces matched.
- **All 38 comparison cases passed.** The temporary comparison test was removed afterward, so it is not counted in the permanent suite.

### Limits

Electron events, dialogs and speech processes were mocked in regression tests. This phase did not launch the packaged app, rebuild the native bundle, invoke OS association changes, generate real Qwen audio or run an end-to-end native dialog session. The prior Phase 2 browser download-delivery limitation remains. JSX comparisons establish markup/callback equivalence for the tested cases, not a new visual/browser smoke test.

## Assumptions and missing context

The README and current implementation define behavior. Error messages, reference capabilities, validation precedence, serialized writes, file permissions, canceled-dialog results and shutdown order are treated as intentional. No product behavior was inferred from missing context. In particular, library corruption remains an error rather than an opportunity to reset user data, and unknown worker stdout remains ignored while the request timeout stays active.

The updated README describes the module layout and test scope. Earlier phase reports link here and retain their historical source snapshots. The following blocks are complete source snapshots at Phase 3 completion; source files remain authoritative for future edits.

## Complete refactored code by chunk

### Chunk 1: Shared caller authorization

**File:** `electron/ipc.cjs`

**Why:** Extracts the existing trust check and invoke wrapper into one small unit used by both handler groups and the dirty-state notification. A window getter avoids capturing an obsolete window.

**Assumptions:** The sender object, main-frame identity and exact URL comparison (ignoring only the fragment) remain unchanged. Authorization stays synchronous and runs before callbacks.

```javascript
/** Keep authorization identical for invoke handlers and one-way notifications. */
function createTrustedIpc(ipcMain, getWindow, appUrl) {
  function trusted(event) {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url.split('#')[0] !== appUrl
    ) {
      throw new Error('Untrusted caller');
    }
  }

  function handle(channel, callback) {
    ipcMain.handle(channel, (event, ...args) => {
      trusted(event);
      return callback(...args);
    });
  }

  return { trusted, handle };
}

module.exports = { createTrustedIpc };
```

### Chunk 2: PDF and recent-file handlers

**File:** `electron/handlers/pdf.cjs`

**Why:** Groups PDF dialogs, queued opens, saves, recents and reload forwarding. Dependencies are explicit, and the existing 512 MB input limit is named.

**Assumptions:** Cancellation results, validation order, queue consumption, filename handling, source capabilities and write-before-remember ordering are preserved. Native association helpers remain lazily required.

```javascript
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_PDF_BYTES = 512 * 1024 * 1024;

function registerPdfHandlers({ handle, app, dialog, getWindow, sources, library, pendingPdfs }) {
  handle('pdf:default', async () => {
    if (process.platform !== 'darwin' || !app.isPackaged) {
      throw new Error('Open the packaged Folio app to change the default PDF app.');
    }
    const { setDefaultPdfApp } = require('../pdf-associations.cjs');
    await setDefaultPdfApp(
      process.resourcesPath,
      path.resolve(process.resourcesPath, '..', '..'),
    );
  });

  handle('pdf:repair', async () => {
    if (process.platform !== 'darwin') throw new Error('Finder repair is available on macOS.');
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Repair Finder opening',
      message: 'Choose a PDF to reset its individual Open With override. It will use your default PDF app; quarantine is preserved.',
      buttonLabel: 'Repair opening',
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { repairPdfAssociation } = require('../pdf-associations.cjs');
    return {
      name: path.basename(result.filePaths[0]),
      repaired: await repairPdfAssociation(result.filePaths[0]),
    };
  });

  handle('pdf:next', async () => {
    const request = pendingPdfs.shift();
    if (!request) return null;
    const { filename, latex } = request;
    const file = await sources.open(filename, latex);
    await library.remember(filename);
    return file;
  });

  handle('pdf:open', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    const file = await sources.open(filename);
    await library.remember(filename);
    return file;
  });

  handle('pdf:save', async (name, data) => {
    if (typeof name !== 'string' || !(data instanceof Uint8Array) || data.length > MAX_PDF_BYTES) {
      throw new Error('Invalid PDF data.');
    }
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: path.basename(name),
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data);
    await library.remember(result.filePath);
    return true;
  });

  handle('library:recents', async () => (await library.read()).recents);
  handle('library:open', async id => {
    const item = (await library.read()).recents.find(item => item.id === id);
    if (!item) throw new Error('This recent file is no longer in your library.');
    const file = await sources.open(item.path);
    await library.remember(item.path);
    return file;
  });
  handle('pdf:reload', (source, version) => sources.reload(source, version));
  handle('library:remove', id => library.removeRecent(id));
}

module.exports = { registerPdfHandlers };
```

### Chunk 3: Voice and speech handlers

**File:** `electron/handlers/voice.cjs`

**Why:** Groups recording selection, inspection, persistence and synthesis requests. The temporary reference map belongs to the registered handler group, with the same application lifetime as before.

**Assumptions:** The renderer still sends opaque IDs. Inspection/saving prefer a temporary selected reference; synthesis prefers a saved profile. These existing precedence rules intentionally remain distinct. Limits and error messages are unchanged.

```javascript
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSCRIPT_LENGTH = 2000;

function registerVoiceHandlers({ handle, dialog, getWindow, library, speech }) {
  // Only recordings selected through the native picker receive a temporary ID.
  const voiceReferences = new Map();

  handle('voice:remove', id => library.removeVoice(id));
  handle('voice:list', () => library.voices());
  handle('voice:inspect', async id => {
    const saved = await library.reference(id);
    const source = voiceReferences.get(id) || saved?.path;
    if (!source) throw new Error('Choose a recording first.');
    const info = await speech.inspectReference(source);
    const extension = path.extname(source).toLowerCase();
    return {
      ...info,
      audio: (await readFile(source)).toString('base64'),
      mime: extension === '.mp3' ? 'audio/mpeg' : extension === '.flac' ? 'audio/flac' : 'audio/wav',
    };
  });

  handle('voice:save', async ({ id, name, transcript, start, end }) => {
    const saved = await library.reference(id);
    const source = voiceReferences.get(id) || saved?.path;
    if (!source) throw new Error('Choose a recording first.');
    const info = await speech.inspectReference(source, { start, end });
    return library.saveVoice(
      source,
      name,
      transcript,
      { start: start || 0, end: end ?? info.duration, duration: info.duration },
      saved?.id,
    );
  });

  handle('tts:status', () => speech.status());
  handle('voice:choose', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Voice reference', extensions: ['mp3', 'wav', 'flac'] }],
    });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    if ((await stat(filename)).size > MAX_REFERENCE_BYTES) {
      throw new Error('Choose a voice sample smaller than 20 MB.');
    }
    const info = await speech.inspectReference(filename);
    if (info.duration < 3) {
      throw new Error(`This recording is ${info.duration.toFixed(1)} seconds long. Choose at least 3 seconds of speech.`);
    }
    const id = randomUUID();
    voiceReferences.set(id, filename);
    return { id, name: path.basename(filename) };
  });

  handle('tts:speak', async request => {
    if (!request || typeof request !== 'object') throw new Error('Invalid speech request.');
    let reference;
    if (request.voice === 'clone') {
      const saved = await library.reference(request.reference?.id);
      // Synthesis prefers the validated saved profile over picker metadata.
      const recordingPath = saved?.path || voiceReferences.get(request.reference?.id);
      const transcript = saved?.transcript || request.reference?.transcript;
      if (
        !recordingPath || typeof transcript !== 'string' ||
        !transcript.trim() || transcript.length > MAX_TRANSCRIPT_LENGTH
      ) {
        throw new Error('Choose a sample and enter its exact transcript.');
      }
      reference = {
        path: recordingPath,
        transcript: transcript.trim(),
        start: saved?.start || 0,
        end: saved?.end,
      };
    }
    return speech.speak({ text: request.text, voice: request.voice, language: request.language, reference });
  });
  handle('tts:stop', () => speech.stop());
}

module.exports = { registerVoiceHandlers };
```

### Chunk 4: Desktop composition and lifecycle

**File:** `electron/main.cjs`

**Why:** Leaves application startup, window security, native open events, unsaved-close protection and shutdown visible in the entry point. Domain operations are registered through the shared authorized wrapper. Dense lifecycle statements are expanded.

**Assumptions:** Single-instance behavior, menus, window settings, focus behavior, dirty-state coercion and speech shutdown order are preserved. The preload API is unchanged.

```javascript
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
```

### Chunk 5: Speech process lifecycle

**File:** `electron/speech.cjs`

**Why:** Expands validation, request settlement, process failures and timeout cleanup. Constants name existing limits. Inspector JSON parsing is separated from throwing the reported validation error, avoiding a throw immediately caught by its own parser block. Comments explain runtime fallback and non-protocol output handling.

**Assumptions:** Invalid input still rejects before spawning; only one generation runs at a time. Timeout length, sequence IDs, error text, pending rejection behavior, stale-process guards and runtime selection remain unchanged.

```javascript
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

const MAX_PASSAGE_LENGTH = 600;
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
const INSPECTION_TIMEOUT_MS = 30000;
const VOICES = ['clone', 'Ryan', 'Aiden', 'Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ono_Anna', 'Sohee'];
const LANGUAGES = ['English', 'Chinese', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian'];

class SpeechWorker {
  constructor(root) {
    this.root = root;
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.stderr = '';
  }

  python() {
    let configured;
    try {
      configured = require('./runtime.json').python;
    } catch {
      // Missing/unreadable development configuration falls back to the local runtime.
    }
    return process.env.FOLIO_PYTHON || configured || path.join(this.root, '.venv', 'bin', 'python');
  }

  status() {
    return {
      available: process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(this.python()),
      message: fs.existsSync(this.python())
        ? 'Qwen runtime installed. First reading downloads the model; later readings use the local cache.'
        : 'Install the optional Qwen runtime to read PDFs aloud on your Mac.',
    };
  }

  async inspectReference(filename, selection) {
    const run = require('node:util').promisify(execFile);
    const args = [path.join(this.root, 'speech', 'reference.py'), filename];
    if (selection) args.push(JSON.stringify(selection));
    let output;
    try {
      output = (await run(this.python(), args, {
        timeout: INSPECTION_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      })).stdout;
    } catch (error) {
      // The Python inspector reports validation failures as JSON, even on failure.
      let failure;
      try {
        failure = JSON.parse(error.stdout);
      } catch (parsed) {
        if (parsed instanceof SyntaxError) {
          throw new Error('Unable to inspect the recording. Check the local speech runtime.');
        }
        throw parsed;
      }
      throw new Error(failure.error);
    }
    const result = JSON.parse(output);
    if (result.error) throw new Error(result.error);
    return result;
  }

  start() {
    if (this.child) return;
    if (!this.status().available) {
      throw new Error('Run npm run setup:tts in the Folio folder first. Requires an Apple Silicon Mac.');
    }
    this.stderr = '';
    const child = spawn(this.python(), ['-u', path.join(this.root, 'speech', 'worker.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TOKENIZERS_PARALLELISM: 'false', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
    });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // Ignore non-protocol output; leave the pending request and timeout intact.
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error))
        : pending.resolve({ audio: message.audio });
    });
    child.stderr.on('data', data => {
      this.stderr = (this.stderr + data.toString()).slice(-4000);
    });
    const fail = error => {
      // An old process can exit after stop() has already started a replacement.
      if (this.child !== child) return;
      this.child = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
    };
    child.on('error', error => fail(error));
    child.on('exit', code => fail(new Error(
      `Qwen worker stopped (${code}). ${this.stderr.slice(-1200) || 'Check the optional Python runtime installation.'}`,
    )));
  }

  speak({ text, voice, language, reference }) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_PASSAGE_LENGTH) {
      return Promise.reject(new Error('Speech passages must contain 1–600 characters.'));
    }
    if (voice === 'clone' && (!reference || typeof reference.path !== 'string' || typeof reference.transcript !== 'string')) {
      return Promise.reject(new Error('A reference recording and transcript are required.'));
    }
    if (!VOICES.includes(voice)) return Promise.reject(new Error('Unknown voice.'));
    if (!LANGUAGES.includes(language)) return Promise.reject(new Error('Unknown language.'));
    if (this.pending.size) return Promise.reject(new Error('A speech passage is already being generated.'));
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.stop(
        'Speech timed out. The initial model download may need more time; try again.',
      ), GENERATION_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ id, text, voice, language, reference }) + '\n');
    });
  }

  stop(message = 'Reading stopped.') {
    const child = this.child;
    this.child = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    this.pending.clear();
    child?.kill();
  }
}

module.exports = { SpeechWorker };
```

### Chunk 6: Serialized local storage

**File:** `electron/library.cjs`

**Why:** Makes atomic writes, queued updates, reference copies, validation and deletion easier to audit. Documents why the queue catches a rejection while the original returned operation still fails.

**Assumptions:** Storage paths, file permissions, copy/rename/delete order, trimming, limits and validation order remain unchanged. Missing storage returns defaults; corrupted storage still rejects instead of being overwritten.

```javascript
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_RECENTS = 20;
const MAX_VOICE_BYTES = 20 * 1024 * 1024;

class Library {
  constructor(directory) {
    this.directory = directory;
    this.tail = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory, 'library.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { recents: [], voices: [] };
      throw error;
    }
  }

  update(change) {
    const work = this.tail.then(async () => {
      const state = await this.read();
      const result = await change(state);
      await fs.mkdir(this.directory, { recursive: true });
      const temp = path.join(this.directory, 'library.json.tmp');
      await fs.writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temp, path.join(this.directory, 'library.json'));
      return result;
    });
    this.tail = work.catch(() => {
      // Recover the queue only. The returned work still rejects for its caller.
    });
    return work;
  }

  async remember(filename) {
    return this.update(state => {
      const existing = state.recents.find(item => item.path === filename);
      const item = {
        id: existing?.id || randomUUID(),
        name: path.basename(filename),
        path: filename,
        openedAt: new Date().toISOString(),
      };
      state.recents = [item, ...state.recents.filter(entry => entry.path !== filename)].slice(0, MAX_RECENTS);
      return item;
    });
  }

  async removeRecent(id) {
    return this.update(state => {
      state.recents = state.recents.filter(item => item.id !== id);
    });
  }

  async openRecent(id) {
    const item = (await this.read()).recents.find(item => item.id === id);
    if (!item) throw new Error('This recent file is no longer in your library.');
    const data = new Uint8Array(await fs.readFile(item.path));
    await this.remember(item.path);
    return { name: item.name, data };
  }

  async saveVoice(source, name, transcript, segment = {}, existingId = null) {
    if (
      typeof name !== 'string' || !name.trim() || name.length > 80 ||
      typeof transcript !== 'string' || !transcript.trim() || transcript.length > 2000
    ) {
      throw new Error('Enter a voice name and the exact sample transcript.');
    }
    if ((await fs.stat(source)).size > MAX_VOICE_BYTES) throw new Error('Voice sample exceeds 20 MB.');
    if (segment.start !== undefined && (
      !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.start < 0 || segment.end - segment.start < 3 || segment.end - segment.start > 30
    )) {
      throw new Error('Choose a 3–30-second voice segment.');
    }
    const id = existingId || randomUUID();
    const extension = path.extname(source).toLowerCase();
    if (!['.mp3', '.wav', '.flac'].includes(extension)) throw new Error('Choose an MP3, WAV, or FLAC sample.');
    return this.update(async state => {
      const folder = path.join(this.directory, 'voices');
      await fs.mkdir(folder, { recursive: true });
      const destination = path.join(folder, id + extension);
      if (path.resolve(source) !== path.resolve(destination)) await fs.copyFile(source, destination);
      await fs.chmod(destination, 0o600);
      const voice = { id, name: name.trim(), transcript: transcript.trim(), path: destination, ...segment };
      if (existingId) {
        const index = state.voices.findIndex(voice => voice.id === existingId);
        if (index < 0) throw new Error('Saved voice not found.');
        state.voices[index] = voice;
      } else {
        state.voices.push(voice);
      }
      return { id, name: voice.name, transcript: voice.transcript, ...segment };
    });
  }

  async removeVoice(id) {
    return this.update(async state => {
      const voice = state.voices.find(item => item.id === id);
      if (!voice) throw new Error('Saved voice not found.');
      const folder = path.resolve(this.directory, 'voices');
      if (path.dirname(path.resolve(voice.path)) !== folder) throw new Error('Invalid saved recording path.');
      await fs.rm(voice.path, { force: true });
      state.voices = state.voices.filter(item => item.id !== id);
    });
  }

  async voices() {
    return (await this.read()).voices.map(({ id, name, transcript, start, end, duration }) => (
      { id, name, transcript, start, end, duration }
    ));
  }

  async reference(id) {
    return (await this.read()).voices.find(voice => voice.id === id);
  }
}

module.exports = { Library };
```

### Chunk 7: Desktop syntax verification

**File:** `scripts/check-desktop.cjs`

**Why:** Checks every CommonJS file under electron recursively, so new handler modules cannot be omitted from the build check.

**Assumptions:** The check performs syntax validation only and exits on failure. It does not launch Electron, execute handlers or modify runtime data.

```javascript
const { readdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Check newly extracted modules as well as the Electron entry points.
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(filename);
    else if (entry.name.endsWith('.cjs')) {
      execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
    }
  }
}

checkDirectory(path.join(__dirname, '..', 'electron'));
```

### Chunk 8: Build integration

**File:** `package.json`

**Why:** Routes the existing check:desktop command through the recursive syntax checker. No runtime dependencies were added.

**Assumptions:** Build, desktop and packaging commands retain their existing sequence. The existing electron/**/* packaging pattern already includes the extracted modules.

```json
{
  "name": "folio-pdf",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "A local-first PDF workspace",
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "npm run check:desktop && tsc -b && vite build",
    "preview": "vite preview --host 127.0.0.1",
    "desktop": "npm run build && electron .",
    "desktop:dev": "concurrently -k \"vite --host 127.0.0.1\" \"wait-on http://127.0.0.1:5173 && electron . --dev\"",
    "test": "vitest run",
    "setup:tts": "sh scripts/setup-tts.sh",
    "package:mac": "npm run build && node scripts/package-mac.cjs && electron-builder --mac dir",
    "check:desktop": "node scripts/check-desktop.cjs"
  },
  "dependencies": {
    "lucide-react": "^1.47.0",
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^6.3.289",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.1.1",
    "concurrently": "^10.0.5",
    "electron": "^44.4.3",
    "electron-builder": "^26.15.3",
    "typescript": "~7.0.2",
    "vite": "^8.3.0",
    "vitest": "^5.0.1",
    "wait-on": "^9.0.0"
  },
  "build": {
    "appId": "com.folio.pdf",
    "productName": "Folio",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json"
    ],
    "mac": {
      "icon": "electron/icons/folio.icns",
      "category": "public.app-category.productivity",
      "target": [
        "dir"
      ],
      "identity": null,
      "extendInfo": {
        "CFBundleDocumentTypes": [
          {
            "CFBundleTypeName": "PDF document",
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": [
              "com.adobe.pdf"
            ],
            "CFBundleTypeExtensions": [
              "pdf"
            ],
            "CFBundleTypeIconFile": "icon.icns"
          }
        ]
      }
    },
    "win": {
      "icon": "electron/icons/folio.ico"
    },
    "extraResources": [
      {
        "from": "speech",
        "to": "speech"
      },
      {
        "from": "artifacts/native",
        "to": "native",
        "filter": [
          "pdf-default"
        ]
      }
    ],
    "asar": true
  }
}
```

### Chunk 9: Bookmark dialog view

**File:** `src/workspace/BookmarkDialog.tsx`

**Why:** Moves the modal form into a module-level component with typed draft and event callbacks. This removes a substantial JSX block from App while leaving document mutation ownership in App.

**Assumptions:** DOM elements, nesting, classes, labels, autofocus, maximum title length, disabled state and callback inputs are unchanged. The component adds no state, effects or wrapper elements.

```tsx
import type { FormEventHandler } from "react";

export type BookmarkDraft = { id?: string; title: string; page: number };

type BookmarkDialogProps = {
  bookmarkDraft: BookmarkDraft;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: (draft: BookmarkDraft) => void;
  onClose: () => void;
};

export function BookmarkDialog({
  bookmarkDraft, onSubmit, onChange, onClose,
}: BookmarkDialogProps) {
  return (
    <div className="modal-backdrop">
      <form
        className="settings-dialog"
        role="dialog"
        aria-label="Bookmark"
        onSubmit={onSubmit}
      >
        <h2>Keep your place</h2>
        <p>Page {bookmarkDraft.page} · saved locally for this document</p>
        <label>
          Bookmark name
          <input
            autoFocus
            className="bookmark-name"
            aria-label="Bookmark name"
            value={bookmarkDraft.title}
            maxLength={160}
            onChange={(e) =>
              onChange({ ...bookmarkDraft, title: e.target.value })
            }
          />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={!bookmarkDraft.title.trim()}
        >
          Save bookmark
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
```

### Chunk 10: LaTeX controls view

**File:** `src/workspace/LatexControls.tsx`

**Why:** Moves the compiler-preview controls into a module-level component. Status presentation is separate from document operations.

**Assumptions:** Parent visibility gates remain in App. The toggle still updates mode before clearing reload status, and the same DOM and status messages are rendered.

```tsx
import type { DocumentWorkspace } from "./useDocumentWorkspace";

type LatexControlsProps = Pick<
  DocumentWorkspace,
  "source" | "latex" | "dirty" | "reloadStatus" | "setLatex" | "setReloadStatus"
>;

export function LatexControls({
  source, latex, dirty, reloadStatus, setLatex, setReloadStatus,
}: LatexControlsProps) {
  return (
    <div className="latex-controls">
      {source && (
        <button
          className="text-button"
          aria-pressed={latex}
          title="Reload compiler output automatically; pauses while you have unsaved edits"
          onClick={() => {
            setLatex(!latex);
            setReloadStatus("");
          }}
        >
          LaTeX {latex ? "on" : "off"}
        </button>
      )}
      {latex && (
        <span role="status">
          {dirty
            ? "Reload paused · unsaved edits"
            : reloadStatus || "Watching for PDF changes"}
        </span>
      )}
    </div>
  );
}
```

### Chunk 11: Application composition

**File:** `src/App.tsx`

**Why:** Replaces inline bookmark and LaTeX markup with module-level components. The bookmark submit sequence is now a named parent action. App shrinks from 406 to 365 lines in this phase (originally 1,577 before Phase 2).

**Assumptions:** Submission still prevents the default event, rejects blank names, trims titles, updates/appends the bookmark, closes the draft, selects bookmarks and reveals the rail in the same order. The draft is passed from the same render snapshot as before.

```tsx
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BookmarkDialog } from "./workspace/BookmarkDialog";
import type { BookmarkDraft } from "./workspace/BookmarkDialog";
import { LatexControls } from "./workspace/LatexControls";
import { Check, ChevronRight, X } from "lucide-react";
import Listen from "./Listen";
import Settings from "./Settings";
import { usePreferences } from "./preferences";
import type { Bookmark } from "./preferences";
import type { Navigation } from "./workspace/types";
import { useDocumentWorkspace } from "./workspace/useDocumentWorkspace";
import { useReaderIdle } from "./workspace/useReaderIdle";
import { WorkspaceHeader } from "./workspace/WorkspaceHeader";
import { StartScreen } from "./workspace/StartScreen";
import { DocumentTabs } from "./workspace/DocumentTabs";
import { WorkspaceToolbar } from "./workspace/WorkspaceToolbar";
import { NavigationRail } from "./workspace/NavigationRail";
import { DocumentStage } from "./workspace/DocumentStage";
import { DetailsPanel } from "./workspace/DetailsPanel";

export default function App() {
  const [preferences, updatePreferences] = usePreferences();
  const [settings, setSettings] = useState(false);
  const [navigation, setNavigation] = useState<Navigation>("pages");
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);
  const panel = preferences.panel;
  const setPanel = (panel: "listen" | "details") =>
    updatePreferences({ panel, sidebarVisible: true });
  const rail = preferences.navigationVisible;
  const setRail = (navigationVisible: boolean) =>
    updatePreferences({ navigationVisible });
  const [note, setNote] = useState("");
  const [color, setColor] = useState("#c5a634");
  const [fontSize, setFontSize] = useState(preferences.fontSize);
  useEffect(() => {
    setFontSize(preferences.fontSize);
  }, [preferences.fontSize]);
  const readerIdle = useReaderIdle();
  const {
    recents,
    source,
    tabs,
    activeTabId,
    latex,
    setLatex,
    reloadStatus,
    setReloadStatus,
    pdf,
    bytes,
    setFitMode,
    name,
    page,
    setPage,
    zoom,
    setZoom,
    tool,
    setTool,
    query,
    setQuery,
    readingHighlight,
    setReadingHighlight,
    texts,
    busy,
    error,
    setError,
    notice,
    bookmarks,
    setBookmarks,
    dirty,
    past,
    future,
    input,
    mergeInput,
    stage,
    tabStrip,
    goToPage,
    reportError,
    switchTab,
    closeTab,
    open,
    edit,
    history,
    save,
    merge,
    mark,
    fit,
    goHome,
    explore,
    openRecent,
    removeRecent,
    openBrowserFile,
    mergeBrowserFile,
  } = useDocumentWorkspace(preferences, settings);
  const latexControls = source && preferences.showLatex ? (
    <LatexControls
      source={source}
      latex={latex}
      dirty={dirty}
      reloadStatus={reloadStatus}
      setLatex={setLatex}
      setReloadStatus={setReloadStatus}
    />
  ) : null;
  const addBookmark = () => {
    setBookmarkDraft({ title: `Page ${page}`, page });
  };
  const renameBookmark = (bookmark: Bookmark) => setBookmarkDraft(bookmark);
  const saveBookmark = (bookmarkDraft: BookmarkDraft, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bookmarkDraft.title.trim()) return;
    const entry = {
      ...bookmarkDraft,
      id: bookmarkDraft.id || crypto.randomUUID(),
      title: bookmarkDraft.title.trim(),
    };
    setBookmarks((current) =>
      bookmarkDraft.id
        ? current.map((b) => (b.id === entry.id ? entry : b))
        : [...current, entry],
    );
    setBookmarkDraft(null);
    setNavigation("bookmarks");
    setRail(true);
  };
  const bookmarkDialog = bookmarkDraft && (
    <BookmarkDialog
      bookmarkDraft={bookmarkDraft}
      onSubmit={(e) => saveBookmark(bookmarkDraft, e)}
      onChange={setBookmarkDraft}
      onClose={() => setBookmarkDraft(null)}
    />
  );
  const header = (
    <WorkspaceHeader
      busy={busy}
      bytes={bytes}
      goHome={goHome}
      open={open}
      save={save}
      onSettings={() => setSettings(true)}
    />
  );
  const settingsDialog = settings && (
    <Settings
      value={preferences}
      update={updatePreferences}
      close={() => setSettings(false)}
    />
  );
  const appClass = `app theme-${preferences.theme} ${preferences.dark ? "dark-theme" : ""} ${preferences.compact ? "compact" : ""}`;
  if (!pdf)
    return (
      <div
        className={appClass}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) openBrowserFile(file);
        }}
      >
        {header}
        <StartScreen
          busy={busy}
          recents={recents}
          error={error}
          open={open}
          explore={explore}
          openRecent={openRecent}
          removeRecent={removeRecent}
          showExplore={preferences.showExplore}
          onSettings={() => setSettings(true)}
        />
        <footer>
          <span></span>
          <span>Folio</span>
        </footer>
        {settingsDialog}
        <input
          type="file"
          ref={input}
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openBrowserFile(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  return (
    <div
      className={`${appClass}${latex ? " latex-workspace" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) openBrowserFile(file);
      }}
    >
      {header}
      <DocumentTabs
        tabs={tabs}
        activeTabId={activeTabId}
        dirty={dirty}
        name={name}
        busy={busy}
        tabStrip={tabStrip}
        switchTab={switchTab}
        closeTab={closeTab}
        open={open}
        addBookmark={addBookmark}
      />
      <WorkspaceToolbar
        busy={busy}
        latex={latex}
        tool={tool}
        setTool={setTool}
        past={past}
        future={future}
        history={history}
        rail={rail}
        setRail={setRail}
        panel={panel}
        setPanel={setPanel}
        preferences={preferences}
        updatePreferences={updatePreferences}
        note={note}
        setNote={setNote}
        fontSize={fontSize}
        setFontSize={setFontSize}
        color={color}
        setColor={setColor}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="workspace">
        {rail && !latex && (
          <NavigationRail
            pdf={pdf}
            bookmarks={bookmarks}
            setBookmarks={setBookmarks}
            query={query}
            setQuery={setQuery}
            texts={texts}
            page={page}
            setPage={setPage}
            busy={busy}
            merge={merge}
            navigation={navigation}
            setNavigation={setNavigation}
            addBookmark={addBookmark}
            renameBookmark={renameBookmark}
          />
        )}
        <DocumentStage
          pdf={pdf}
          stage={stage}
          tool={tool}
          page={page}
          latex={latex}
          zoom={zoom}
          busy={busy}
          readingHighlight={readingHighlight}
          mark={mark}
          reportError={reportError}
          setPage={setPage}
          goToPage={goToPage}
          setFitMode={setFitMode}
          setZoom={setZoom}
          fit={fit}
          readerIdle={readerIdle}
          note={note}
          fontSize={fontSize}
          color={color}
        />
        {panel === "listen" && !latex ? (
          <Listen
            sidebarControls={latexControls}
            hidden={!preferences.sidebarVisible}
            text={texts[page - 1] || ""}
            page={page}
            texts={texts}
            ready={!busy && texts.length === pdf.numPages}
            documentId={pdf}
            onPage={setPage}
            onReadingHighlight={setReadingHighlight}
            preferences={preferences}
            updatePreferences={updatePreferences}
          />
        ) : (
          <DetailsPanel
            pdf={pdf}
            bytes={bytes}
            page={page}
            latex={latex}
            busy={busy}
            bookmarks={bookmarks}
            edit={edit}
            latexControls={latexControls}
            hidden={!preferences.sidebarVisible}
          />
        )}
      </div>
      <footer>
        <span>
          <span className="status-dot ready" />{" "}
          {window.folio ? "On your Mac" : "Local browser preview"}
        </span>
        <span>
          PDF workspace <span className="footer-dot">·</span> Folio 0.1
        </span>
        <button
          className="text-button"
          onClick={() => setPanel(panel === "details" ? "listen" : "details")}
        >
          {panel === "details" ? "Listen to document" : "Organize pages"}{" "}
          <ChevronRight size={12} />
        </button>
      </footer>
      {settingsDialog}
      {bookmarkDialog}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      <input
        type="file"
        ref={input}
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openBrowserFile(file);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        ref={mergeInput}
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) mergeBrowserFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

### Chunk 12: Existing Finder-open regression

**File:** `tests/desktopOpen.test.js`

**Why:** Adjusts only the CommonJS resolution base so the VM-based main-process test can resolve newly extracted production modules.

**Assumptions:** All existing assertions and mocks remain. The test still verifies pre-window queued opens, one-time consumption and remembered paths.

```javascript
import { it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../electron/main.cjs', import.meta.url));

it('queues Finder opens before window creation and consumes each PDF once', async () => {
  const events = new Map();
  const handlers = new Map();
  const remembered = [];
  const app = {
    getPath: () => '/tmp/folio-test',
    requestSingleInstanceLock: () => true,
    on: (name, callback) => events.set(name, callback),
    isReady: () => false,
    whenReady: () => ({ then() {} }),
  };
  const context = vm.createContext({
    __dirname: '/folio/electron', process: { argv: [], cwd: () => '/tmp', platform: 'darwin' },
    Uint8Array,
    require(name) {
      if (name === 'electron') return { app, ipcMain: {
        handle: (name, callback) => handlers.set(name, callback), on() {},
      } };
      if (name === './library.cjs') return { Library: class {
        async remember(filename) { remembered.push(filename); }
      } };
      if (name === './latex.cjs') return { launchFiles: () => [], PdfSources: class { async open(filename) { return { name: filename.split('/').pop(), data: new Uint8Array() }; } } };
      if (name === './speech.cjs') return { SpeechWorker: class {} };
      if (name === 'node:fs/promises') return {
        readFile: async filename => Buffer.from(filename),
      };
      return require(name);
    },
  });
  vm.runInContext(readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8'), context);
  let prevented = 0;
  events.get('open-file')({ preventDefault: () => prevented++ }, '/first.pdf');
  events.get('open-file')({ preventDefault: () => prevented++ }, '/second.pdf');
  const contents = { mainFrame: { url: 'file:///folio/dist/index.html' } };
  context.testWindow = { webContents: contents };
  vm.runInContext('win = testWindow', context);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const next = () => handlers.get('pdf:next')(event);
  expect((await next()).name).toBe('first.pdf');
  expect((await next()).name).toBe('second.pdf');
  expect(await next()).toBeNull();
  expect(prevented).toBe(2);
  expect(remembered).toEqual(['/first.pdf', '/second.pdf']);
});
```

### Chunk 13: Authorization and handler regressions

**File:** `tests/desktopHandlers.test.js`

**Why:** Adds tests for unauthorized callers, replaced windows, canceled dialogs, save validation/order, queued failures, recent/reload capabilities and opaque voice references. Tests use temporary generated files.

**Assumptions:** Electron dialogs and speech services are mocked; these tests do not validate native OS UI or audio decoding.

```javascript
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
```

### Chunk 14: Native lifecycle regressions

**File:** `tests/desktopLifecycle.test.js`

**Why:** Exercises main.cjs with mocked Electron events to protect keep-editing/discard behavior, renderer unload handling, sandbox settings and secondary-instance shutdown.

**Assumptions:** This is a lifecycle contract test, not an end-to-end macOS dialog test. The same four cases also passed against the pre-refactor main process.

```javascript
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
```

### Chunk 15: Worker lifecycle regressions

**File:** `tests/speechWorker.test.js`

**Why:** Tests validation, matching replies, non-protocol lines, concurrency, cancellation/restart, process errors, timeout cleanup and inspector errors without launching Python generation.

**Assumptions:** Child processes and inspection commands are mocked; fake timers cover the existing 15-minute limit. The same six cases also passed against the original worker.

```javascript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import vm from 'node:vm';

const require = createRequire(new URL('../electron/speech.cjs', import.meta.url));
const source = readFileSync(new URL('../electron/speech.cjs', import.meta.url), 'utf8');
const workers = [];
afterEach(() => {
  for (const worker of workers.splice(0)) worker.stop();
  vi.useRealTimers();
});

function setup() {
  const children = [];
  const lines = [];
  const inspect = vi.fn();
  const execFile = () => {};
  execFile[promisify.custom] = inspect;
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = {};
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn() };
    child.kill = vi.fn();
    children.push(child);
    return child;
  });
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, process, setTimeout, clearTimeout,
    require(name) {
      if (name === 'node:child_process') return { spawn, execFile };
      if (name === 'node:readline') return { createInterface: () => {
        const stream = new EventEmitter();
        lines.push(stream);
        return stream;
      } };
      return require(name);
    },
  });
  const worker = new module.exports.SpeechWorker('/fixture');
  worker.status = () => ({ available: true });
  workers.push(worker);
  return { worker, spawn, children, lines, inspect };
}
const request = { text: 'A passage.', voice: 'Ryan', language: 'English' };

describe('speech process lifecycle', () => {
  it('rejects invalid input before starting a process', async () => {
    const test = setup();
    await expect(test.worker.speak({ ...request, text: 'x'.repeat(601) })).rejects.toThrow('1–600');
    await expect(test.worker.speak({ ...request, voice: 'unknown' })).rejects.toThrow('Unknown voice.');
    await expect(test.worker.speak({ ...request, voice: 'clone' })).rejects.toThrow('reference recording');
    expect(test.spawn).not.toHaveBeenCalled();
  });

  it('keeps one request pending across non-protocol lines and settles its matching reply', async () => {
    const test = setup();
    const result = test.worker.speak(request);
    await expect(test.worker.speak(request)).rejects.toThrow('already being generated');
    test.lines[0].emit('line', 'model progress');
    test.lines[0].emit('line', JSON.stringify({ id: 999, audio: 'stale' }));
    expect(test.worker.pending.size).toBe(1);
    test.lines[0].emit('line', JSON.stringify({ id: 1, audio: 'valid' }));
    await expect(result).resolves.toEqual({ audio: 'valid' });
    expect(test.worker.pending.size).toBe(0);
    expect(JSON.parse(test.children[0].stdin.write.mock.calls[0][0])).toEqual({ id: 1, ...request });
  });

  it('cancels pending work and ignores an old process exit after restarting', async () => {
    const test = setup();
    const first = test.worker.speak(request);
    const canceled = expect(first).rejects.toThrow('Reading stopped.');
    test.worker.stop();
    await canceled;
    expect(test.children[0].kill).toHaveBeenCalledOnce();
    const next = test.worker.speak(request);
    test.children[0].emit('exit', 1);
    expect(test.worker.child).toBe(test.children[1]);
    test.lines[1].emit('line', JSON.stringify({ id: 2, audio: 'next' }));
    await expect(next).resolves.toEqual({ audio: 'next' });
  });

  it('rejects pending work on process failure and clears its timeout', async () => {
    vi.useFakeTimers();
    const test = setup();
    const result = test.worker.speak(request);
    const failed = expect(result).rejects.toThrow('spawn failed');
    test.children[0].emit('error', new Error('spawn failed'));
    await failed;
    expect(test.worker.child).toBeNull();
    expect(test.worker.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops generation at the existing timeout', async () => {
    vi.useFakeTimers();
    const test = setup();
    const timedOut = expect(test.worker.speak(request)).rejects.toThrow('Speech timed out.');
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await timedOut;
    expect(test.children[0].kill).toHaveBeenCalledOnce();
    expect(test.worker.pending.size).toBe(0);
  });

  it('preserves inspector validation errors and its unreadable-output fallback', async () => {
    const test = setup();
    test.inspect.mockResolvedValueOnce({ stdout: '{"duration":12}' });
    await expect(test.worker.inspectReference('/voice.wav', { start: 2, end: 8 })).resolves.toEqual({ duration: 12 });
    expect(test.inspect.mock.calls[0][1]).toEqual(['/fixture/speech/reference.py', '/voice.wav', '{"start":2,"end":8}']);
    test.inspect.mockRejectedValueOnce({ stdout: '{"error":"Silent recording"}' });
    await expect(test.worker.inspectReference('/voice.wav')).rejects.toThrow('Silent recording');
    test.inspect.mockRejectedValueOnce({ stdout: 'runtime failed' });
    await expect(test.worker.inspectReference('/voice.wav')).rejects.toThrow('Unable to inspect the recording.');
  });
});
```

### Chunk 16: Storage failure regressions

**File:** `tests/library.test.js`

**Why:** Adds tests that failed mutations reject without poisoning queued work and that malformed JSON is preserved instead of silently reset. Existing tests remain intact.

**Assumptions:** All test writes use temporary directories and generated content; cleanup removes only those test directories.

```javascript
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

describe('library failure recovery', () => {
  it('rejects a failed update without poisoning the queue or persisting partial changes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-library-recovery-'));
    try {
      const library = new Library(directory);
      const failed = library.update(state => {
        state.recents.push({ id: 'partial' });
        throw new Error('Update failed');
      });
      const rejection = expect(failed).rejects.toThrow('Update failed');
      const next = library.remember('/next.pdf');
      await rejection;
      const saved = await next;
      expect((await new Library(directory).read()).recents).toEqual([saved]);
    } finally { await rm(directory, { recursive: true }); }
  });

  it('reports malformed storage rather than replacing it with an empty library', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'folio-library-corrupt-'));
    try {
      const filename = path.join(directory, 'library.json');
      await writeFile(filename, '{broken');
      await expect(new Library(directory).remember('/next.pdf')).rejects.toThrow();
      expect(await readFile(filename, 'utf8')).toBe('{broken');
    } finally { await rm(directory, { recursive: true }); }
  });
});
```

