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
