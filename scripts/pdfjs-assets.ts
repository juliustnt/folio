import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

// PDF.js requests decoder files by name, so preserve names in dev and builds.
export function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const directory = join(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');
  const files = new Map(readdirSync(directory).map(name => [name, readFileSync(join(directory, name))]));
  return {
    name: 'folio-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/wasm/', (req, res, next) => {
        const name = (req.url || '').split('?')[0].slice(1);
        const content = files.get(name);
        if (!content) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(content);
      });
    },
    generateBundle() {
      for (const [name, source] of files) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/wasm/${name}`, source });
      }
    },
  };
}
