/** Keep authorization identical for invoke handlers and one-way notifications. */
function createTrustedIpc(ipcMain, getWindow, appUrl) {
  function trusted(event) {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url.split('#')[0] !== appUrl
    ) {
      throw new Error('Untrusted caller');
    }
  }

  function handle(channel, callback) {
    ipcMain.handle(channel, (event, ...args) => {
      trusted(event);
      return callback(...args);
    });
  }

  return { trusted, handle };
}

module.exports = { createTrustedIpc };
