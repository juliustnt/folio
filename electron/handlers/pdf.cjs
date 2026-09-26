const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_PDF_BYTES = 512 * 1024 * 1024;

function registerPdfHandlers({ handle, app, dialog, getWindow, sources, library, pendingPdfs }) {
  handle('pdf:default', async () => {
    if (process.platform !== 'darwin' || !app.isPackaged) {
      throw new Error('Open the packaged Folio app to change the default PDF app.');
    }
    const { setDefaultPdfApp } = require('../pdf-associations.cjs');
    await setDefaultPdfApp(
      process.resourcesPath,
      path.resolve(process.resourcesPath, '..', '..'),
    );
  });

  handle('pdf:repair', async () => {
    if (process.platform !== 'darwin') throw new Error('Finder repair is available on macOS.');
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Repair Finder opening',
      message: 'Choose a PDF to reset its individual Open With override. It will use your default PDF app; quarantine is preserved.',
      buttonLabel: 'Repair opening',
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { repairPdfAssociation } = require('../pdf-associations.cjs');
    return {
      name: path.basename(result.filePaths[0]),
      repaired: await repairPdfAssociation(result.filePaths[0]),
    };
  });

  handle('pdf:next', async () => {
    const request = pendingPdfs.shift();
    if (!request) return null;
    const { filename, latex } = request;
    const file = await sources.open(filename, latex);
    await library.remember(filename);
    return file;
  });

  handle('pdf:open', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    const file = await sources.open(filename);
    await library.remember(filename);
    return file;
  });

  handle('pdf:save', async (name, data) => {
    if (typeof name !== 'string' || !(data instanceof Uint8Array) || data.length > MAX_PDF_BYTES) {
      throw new Error('Invalid PDF data.');
    }
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: path.basename(name),
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data);
    await library.remember(result.filePath);
    return true;
  });

  handle('library:recents', async () => (await library.read()).recents);
  handle('library:open', async id => {
    const item = (await library.read()).recents.find(item => item.id === id);
    if (!item) throw new Error('This recent file is no longer in your library.');
    const file = await sources.open(item.path);
    await library.remember(item.path);
    return file;
  });
  handle('pdf:reload', (source, version) => sources.reload(source, version));
  handle('library:remove', id => library.removeRecent(id));
}

module.exports = { registerPdfHandlers };
