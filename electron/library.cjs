const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
class Library {
  constructor(directory) { this.directory = directory; this.tail = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, 'library.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { recents: [], voices: [] }; throw error; }
  }
  update(change) {
    const work = this.tail.then(async () => {
      const state = await this.read(); const result = await change(state);
      await fs.mkdir(this.directory, { recursive: true });
      const temp = path.join(this.directory, 'library.json.tmp');
      await fs.writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temp, path.join(this.directory, 'library.json')); return result;
    });
    this.tail = work.catch(() => {}); return work;
  }
  async remember(filename) {
    return this.update(state => {
      const existing = state.recents.find(item => item.path === filename);
      const item = { id: existing?.id || randomUUID(), name: path.basename(filename), path: filename, openedAt: new Date().toISOString() };
      state.recents = [item, ...state.recents.filter(entry => entry.path !== filename)].slice(0, 20); return item;
    });
  }
  async openRecent(id) {
    const item = (await this.read()).recents.find(item => item.id === id);
    if (!item) throw new Error('This recent file is no longer in your library.');
    const data = new Uint8Array(await fs.readFile(item.path)); await this.remember(item.path); return { name: item.name, data };
  }
  async saveVoice(source, name, transcript, segment = {}, existingId = null) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof transcript !== 'string' || !transcript.trim() || transcript.length > 2000) throw new Error('Enter a voice name and the exact sample transcript.');
    if ((await fs.stat(source)).size > 20 * 1024 * 1024) throw new Error('Voice sample exceeds 20 MB.');
    if (segment.start !== undefined && (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end - segment.start < 3 || segment.end - segment.start > 30)) throw new Error('Choose a 3–30-second voice segment.');
    const id = existingId || randomUUID(); const extension = path.extname(source).toLowerCase();
    if (!['.mp3', '.wav', '.flac'].includes(extension)) throw new Error('Choose an MP3, WAV, or FLAC sample.');
    return this.update(async state => {
      const folder = path.join(this.directory, 'voices'); await fs.mkdir(folder, { recursive: true });
      const destination = path.join(folder, id + extension); if (path.resolve(source) !== path.resolve(destination)) await fs.copyFile(source, destination); await fs.chmod(destination, 0o600);
      const voice = { id, name: name.trim(), transcript: transcript.trim(), path: destination, ...segment };
      if (existingId) { const index = state.voices.findIndex(v => v.id === existingId); if (index < 0) throw new Error('Saved voice not found.'); state.voices[index] = voice; } else state.voices.push(voice); return { id, name: voice.name, transcript: voice.transcript, ...segment };
    });
  }
  async voices() { return (await this.read()).voices.map(({ id, name, transcript, start, end, duration }) => ({ id, name, transcript, start, end, duration })); }
  async reference(id) { return (await this.read()).voices.find(voice => voice.id === id); }
}
module.exports = { Library };
