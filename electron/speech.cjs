const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
class SpeechWorker {
  constructor(root) { this.root = root; this.child = null; this.pending = new Map(); this.sequence = 0; this.stderr = ''; }
  python() { let configured; try { configured = require('./runtime.json').python; } catch {} return process.env.FOLIO_PYTHON || configured || path.join(this.root, '.venv', 'bin', 'python'); }
  status() {
    return { available: process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(this.python()), message: fs.existsSync(this.python()) ? 'Qwen runtime installed. First reading downloads the model; later readings use the local cache.' : 'Install the optional Qwen runtime to read PDFs aloud on your Mac.' };
  }
  async inspectReference(filename, selection) {
    const run = require('node:util').promisify(execFile);
    const args = [path.join(this.root, 'speech', 'reference.py'), filename];
    if (selection) args.push(JSON.stringify(selection));
    let output;
    try { output = (await run(this.python(), args, { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout; }
    catch (error) { try { const result = JSON.parse(error.stdout); throw new Error(result.error); } catch (parsed) { if (parsed instanceof SyntaxError) throw new Error('Unable to inspect the recording. Check the local speech runtime.'); throw parsed; } }
    const result = JSON.parse(output); if (result.error) throw new Error(result.error); return result;
  }
  start() {
    if (this.child) return;
    if (!this.status().available) throw new Error('Run npm run setup:tts in the Folio folder first. Requires an Apple Silicon Mac.');
    this.stderr = '';
    const child = spawn(this.python(), ['-u', path.join(this.root, 'speech', 'worker.py')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TOKENIZERS_PARALLELISM: 'false', HF_HUB_DISABLE_PROGRESS_BARS: '1' } });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timeout); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error)) : pending.resolve({ audio: message.audio });
    });
    child.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
    const fail = error => { if (this.child !== child) return; this.child = null; for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(error); } this.pending.clear(); };
    child.on('error', error => fail(error));
    child.on('exit', code => fail(new Error(`Qwen worker stopped (${code}). ${this.stderr.slice(-1200) || 'Check the optional Python runtime installation.'}`)));
  }
  speak({ text, voice, language, reference }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 600) return Promise.reject(new Error('Speech passages must contain 1–600 characters.'));
    if (voice === 'clone' && (!reference || typeof reference.path !== 'string' || typeof reference.transcript !== 'string')) return Promise.reject(new Error('A reference recording and transcript are required.'));
    if (!['clone','Ryan','Aiden','Vivian','Serena','Uncle_Fu','Dylan','Eric','Ono_Anna','Sohee'].includes(voice)) return Promise.reject(new Error('Unknown voice.'));
    if (!['English','Chinese','Japanese','Korean','German','French','Russian','Portuguese','Spanish','Italian'].includes(language)) return Promise.reject(new Error('Unknown language.'));
    if (this.pending.size) return Promise.reject(new Error('A speech passage is already being generated.'));
    this.start(); const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.stop('Speech timed out. The initial model download may need more time; try again.'), 15 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ id, text, voice, language, reference }) + '\n');
    });
  }
  stop(message = 'Reading stopped.') {
    const child = this.child; this.child = null;
    for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(new Error(message)); }
    this.pending.clear(); child?.kill();
  }
}
module.exports = { SpeechWorker };
