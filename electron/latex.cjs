const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
function launchFiles(argv, cwd) {
  return argv.filter(arg => !arg.startsWith('-') && /\.pdf$/i.test(arg))
    .map(filename => ({ filename: path.resolve(cwd, filename), latex: argv.includes('--latex') }));
}
// Opaque capabilities restrict reloads to files opened through the desktop bridge.
class PdfSources {
  constructor() { this.sources = new Map(); }
  async open(filename, latex = false) {
    const data = new Uint8Array(await fs.readFile(filename));
    const source = [...this.sources].find(([, existing]) => existing === filename)?.[0] || randomUUID();
    const version = this.hash(data);
    this.sources.set(source, filename);
    if (this.sources.size > 100) this.sources.delete(this.sources.keys().next().value);
    const base = filename.replace(/\.pdf$/i, '');
    const detected = (await Promise.all(['.synctex.gz', '.synctex'].map(ext => fs.access(base + ext).then(() => true, () => false)))).some(Boolean);
    return { name: path.basename(filename), data, source, version, latex: latex || detected };
  }
  hash(data) { return createHash('sha256').update(data).digest('hex'); }
  async reload(source, version) {
    const filename = this.sources.get(source);
    if (!filename) throw new Error('Reopen this PDF to enable live reload.');
    try {
      const before = await fs.stat(filename);
      // Require a quiet interval to avoid showing partially written compiler output.
      if (!before.size || Date.now() - before.mtimeMs < 500) return null;
      const data = new Uint8Array(await fs.readFile(filename));
      const after = await fs.stat(filename);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) return null;
      const next = this.hash(data);
      return next === version ? null : { data, version: next };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EBUSY') return null;
      throw error;
    }
  }
}
module.exports = { launchFiles, PdfSources };
