import { it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

it('queues Finder opens before window creation and consumes each PDF once', async () => {
  const events = new Map();
  const handlers = new Map();
  const remembered = [];
  const app = {
    getPath: () => '/tmp/folio-test',
    on: (name, callback) => events.set(name, callback),
    isReady: () => false,
    whenReady: () => ({ then() {} }),
  };
  const context = vm.createContext({
    __dirname: '/folio/electron', process: { argv: [], platform: 'darwin' },
    Uint8Array,
    require(name) {
      if (name === 'electron') return { app, ipcMain: {
        handle: (name, callback) => handlers.set(name, callback), on() {},
      } };
      if (name === './library.cjs') return { Library: class {
        async remember(filename) { remembered.push(filename); }
      } };
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
