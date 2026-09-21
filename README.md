# Folio

A local-first macOS PDF workspace built with TypeScript, React and Electron. PDF.js renders and extracts text; pdf-lib writes changes. Qwen3-TTS runs in an optional Python/MLX worker on Apple Silicon.

## Run on this Mac

Open `release/mac-arm64/Folio.app`, or run:

```sh
npm install
npm run desktop
```

For development, `npm run desktop:dev` runs the interface with live updates. `npm run dev` runs a browser preview; Qwen speech and native file dialogs are desktop-only.

## Features

- Open a PDF through the native file picker, or drag it into the app.
- Select/copy text, search for matching pages, navigate thumbnails, zoom and fit width.
- Add text: enter a note, choose size/color, then click its baseline position on the page.
- Highlight a rectangular area or draw freehand. Marks are embedded into the PDF.
- **Organize pages** opens rotate, move earlier/later, and delete controls.
- Merge another PDF at the end of the current document.
- Undo/redo the last 12 edits; save a copy through the macOS dialog.
- Listen to the current page or selected text with Qwen preset voices, ten language choices, pause/resume, stop and playback speed.
- Unsaved-change protection when opening another document or closing the app.

Shortcuts: **⌘O** open, **⌘S** save a copy, **⌘Z** undo, **⇧⌘Z** redo.

## Local Qwen speech

The runtime and model have been installed and a real WAV generation verified on this development Mac. The app uses `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` through MLX Audio. PDFs and speech input remain local. Model downloads contact Hugging Face; subsequent generation uses its cache.

To set up on another Apple Silicon Mac:

```sh
npm run setup:tts
```

Python 3.13 is preferred when installed. Override the setup interpreter with `FOLIO_PYTHON_SETUP=/path/to/python3 npm run setup:tts`. The setup creates a project-local `.venv`; it does not alter the system Python environment. The first reading downloads model weights and can take several minutes. Speech is read paragraph by paragraph. Wrapped lines are joined and line-end hyphenation is repaired. Long paragraphs split at sentence boundaries (then words if needed). Two passages are buffered before playback; future passages are generated while audio plays. If generation cannot keep up, the UI shows buffering. Enable **Prepare the whole page before playing** to eliminate generation stalls during the reading. This is not token-streamed playback.

Click **Check connection** after setup. For a custom existing runtime, launch with `FOLIO_PYTHON=/absolute/path/to/python npm run desktop`.

## Build and validate

```sh
npm test
npm run build
npm run package:mac
```

The packaged app is a **local development bundle**, not a notarized distributable. Its generated `electron/runtime.json` points to this checkout's Python environment so it can use the verified installation without duplicating it. Keep the checkout in place; rebuild after moving it. A distributable installer with managed runtime setup, updates, signing and notarization is future work. Packaging disables automatic developer-identity signing.

Tests cover PDF transformation round trips, source preservation, annotations, invalid files, last-page protection, and bounded speech chunking. A real Qwen smoke output is saved to `artifacts/qwen-smoke.wav` on this Mac.

## Current boundaries

This is a functional first release, not Acrobat feature parity. It adds PDF content; it does not rewrite existing text. Added text uses Helvetica's WinAnsi character set; unsupported characters are rejected without changing the document. Annotations are flattened content, not independently editable annotation objects. There is no OCR, form editing, secure redaction, digital signing, password support, or general PDF link navigation yet. Scanned PDFs display but need OCR before search or reading aloud. Text extraction follows the PDF's content order, which may be imperfect for multi-column documents.

Page merging copies page content, not every document-level feature such as outlines, attachments or interactive forms. Existing signatures are not preserved as valid after editing. The UI renders only the active page and lazily renders thumbnails; edits rewrite the file and keep in-memory snapshots, so very large files need further optimization. Nothing is autosaved; use **Save a copy** before closing.

## Structure

- `src/` — interface, rendering, PDF operations and read-aloud controller.
- `electron/` — sandboxed window, restricted preload bridge, native dialogs and speech process lifecycle.
- `speech/` — JSON-lines Qwen worker and Python dependencies.
- `tests/` — PDF and speech chunking tests.

## References

- [PDF.js](https://mozilla.github.io/pdf.js/)
- [pdf-lib](https://pdf-lib.js.org/)
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- [MLX Audio Qwen API](https://github.com/Blaizzy/mlx-audio/blob/main/docs/getting-started/quickstart-python.md)

## Paragraph reading and voice cloning

Choose **My cloned voice** in the Listen panel, select a clear MP3, WAV or FLAC sample (3–30 seconds, under 20 MB), then paste its exact transcript. Read the page or a selected passage as usual. The reference stays local and is used for inference; this does not fine-tune or train new model weights. Click **Save voice on this Mac** after choosing a sample and entering its transcript. Folio copies the sample into its application-data folder and saves the name and transcript in `library.json`. Saved voices remain available after restarting or moving the original recording. Select them from **Saved voices** in Listen.

Cloning uses `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`, downloaded on its first use. The worker decodes MP3 locally, resamples to mono 24 kHz, caches the decoded reference, and keeps one Qwen model resident. File access is limited to samples selected in the native picker; the renderer sends an opaque reference ID.

Paragraph boundaries are inferred from PDF line spacing, indentation and font changes. Unusual layouts and multi-column reading order may still need manual text selection. Single newlines in a selected passage are treated as wrapping; blank lines separate paragraphs. Preloading is bounded to two future passages unless whole-page preparation is selected. Stop, document/page changes and closing Listen cancel pending playback and generation.

## Start, navigation, and preferences

Folio now boots to **Start**, with Open PDF, an optional sample document, recent files, and Settings. Recent files remain on disk in their original locations. Missing or moved files show an error and can be reopened through the picker.

The navigation rail has **Pages**, **Contents**, and **Bookmarks**. Contents uses the PDF's embedded outline (including nested and named destinations); files without an outline show page links. Bookmarks are named local entries, not embedded changes to the PDF. They and the last reading position are saved per document content. Page moves/deletions update bookmarks and undo restores them. During PDF edits, bookmark changes are persisted when the PDF copy is saved; discarding PDF edits preserves the saved document's existing bookmarks.

Settings are saved automatically: default zoom, annotation size, last-page restoration, compact mode, dark burgundy mode, reading speed, preload depth, whole-reading preparation, and automatic next-page reading. Voice and language selections are also remembered. Settings and bookmarks use Electron's on-disk local storage. Voice samples/transcripts and recent paths use an atomic JSON library in Electron's user-data directory.

**Continue onto the next page** queues the remaining document and advances the visible page as speech begins there. Prefetch continues across page boundaries. Manual navigation stops the current reading; selecting text reads only the selection. Empty/scanned pages are skipped. Preparation of an entire long document uses more memory and takes longer than bounded preloading.

## Voice sample validation and layout

Recordings can be longer than 30 seconds. **Edit voice** previews the original and lets you select a 3–30-second segment with its matching transcript. Saving validates decoding, segment boundaries, duration, and silence before marking the profile usable. The original recording stays intact; start/end times and the segment transcript are saved with the profile. Older profiles need this one-time segment review. The same validation is used during synthesis.

Voice editing now opens in a separate dialog. The Listen panel keeps playback controls visible and scrolls only its options when necessary. PDFs fit the entire page to the available window by default and refit on resize; use Zoom, Fit width, or Fit whole page to change the view. Settings can disable automatic page fitting.

Validation: `npm test`, `npm run build`, and `.venv/bin/python -m unittest discover -s tests -p 'test_reference.py'`.
