import { describe, expect, it } from 'vitest';
import { build, createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { pdfjsAssets } from '../scripts/pdfjs-assets.ts';

describe('PDF image decoders', () => {
  it('ships named decoders and their licenses in production', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [pdfjsAssets()],
      build: { write: false, rolldownOptions: { input: 'src/features/workspace/documentIdentity.ts' } },
    });
    const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : result.output;
    for (const name of ['jbig2.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2']) {
      const asset = outputs.find(item => item.fileName === `pdfjs/wasm/${name}`);
      expect(Buffer.from(asset.source)).toEqual(readFileSync(`node_modules/pdfjs-dist/wasm/${name}`));
    }
  });

  it('serves the same JBIG2 decoder in development', async () => {
    const server = await createServer({ configFile: false, plugins: [pdfjsAssets()], server: { host: '127.0.0.1', port: 0 } });
    try {
      await server.listen();
      const response = await fetch(`${server.resolvedUrls.local[0]}pdfjs/wasm/jbig2.wasm`);
      expect(response.headers.get('content-type')).toBe('application/wasm');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync('node_modules/pdfjs-dist/wasm/jbig2.wasm'));
    } finally {
      await server.close();
    }
  });
});
