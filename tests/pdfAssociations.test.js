import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { repairPdfAssociation } = createRequire(import.meta.url)('../electron/pdf-associations.cjs');
const run = promisify(execFile);

it.skipIf(process.platform !== 'darwin')('repairs only the Finder override, preserving quarantine, metadata, and PDF bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-association-'));
  try {
    const file = path.join(directory, 'A PDF with spaces.pdf');
    const original = '%PDF-1.7\nSynthetic test fixture';
    await writeFile(file, original);
    await run('/usr/bin/xattr', ['-w', 'com.apple.LaunchServices.OpenWith', 'test-override', file]);
    await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;12345678;FolioTest;', file]);
    await run('/usr/bin/xattr', ['-w', 'com.folio.test', 'keep', file]);
    expect(await repairPdfAssociation(file)).toBe(true);
    expect((await run('/usr/bin/xattr', [file])).stdout).not.toContain('com.apple.LaunchServices.OpenWith');
    expect((await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file])).stdout.trim()).toBe('0081;12345678;FolioTest;');
    expect((await run('/usr/bin/xattr', ['-p', 'com.folio.test', file])).stdout.trim()).toBe('keep');
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await repairPdfAssociation(file)).toBe(false);
  } finally { await rm(directory, { recursive: true }); }
});

it.skipIf(process.platform !== 'darwin')('refuses non-PDF content without removing its override', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-invalid-association-'));
  try {
    const file = path.join(directory, 'fake.pdf');
    await writeFile(file, 'not a PDF');
    await run('/usr/bin/xattr', ['-w', 'com.apple.LaunchServices.OpenWith', 'keep', file]);
    await expect(repairPdfAssociation(file)).rejects.toThrow('PDF header');
    expect((await run('/usr/bin/xattr', ['-p', 'com.apple.LaunchServices.OpenWith', file])).stdout.trim()).toBe('keep');
    await expect(repairPdfAssociation('relative.pdf')).rejects.toThrow('Choose a PDF');
  } finally { await rm(directory, { recursive: true }); }
});
