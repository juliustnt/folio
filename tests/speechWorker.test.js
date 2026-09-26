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
