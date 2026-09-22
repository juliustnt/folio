const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { open } = require('node:fs/promises');
const path = require('node:path');
const run = promisify(execFile);
const overrideAttribute = 'com.apple.LaunchServices.OpenWith';

async function repairPdfAssociation(filename) {
  if (!path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== '.pdf') throw new Error('Choose a PDF document.');
  const file = await open(filename, 'r');
  try {
    const header = Buffer.alloc(1024);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new Error('This file does not contain a PDF header.');
  } finally { await file.close(); }
  const { stdout } = await run('/usr/bin/xattr', [filename]);
  if (!stdout.split('\n').includes(overrideAttribute)) return false;
  // Clear only the per-file app override. Preserve quarantine and all other metadata.
  await run('/usr/bin/xattr', ['-d', overrideAttribute, filename]);
  return true;
}

async function setDefaultPdfApp(resourcesPath, applicationPath) {
  const { stdout } = await run(path.join(resourcesPath, 'native', 'pdf-default'), ['set', applicationPath], { timeout: 120000 });
  if (stdout.trim() !== 'default') throw new Error('macOS did not confirm Folio as the default PDF app.');
}
module.exports = { repairPdfAssociation, setDefaultPdfApp };
