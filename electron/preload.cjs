const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('folio', {
  recents: () => ipcRenderer.invoke('library:recents'),
  openRecent: id => ipcRenderer.invoke('library:open', id),
  voices: () => ipcRenderer.invoke('voice:list'),
  inspectVoice: id => ipcRenderer.invoke('voice:inspect', id),
  saveVoice: profile => ipcRenderer.invoke('voice:save', profile),
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  savePdf: (name, data) => ipcRenderer.invoke('pdf:save', name, data),
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  chooseVoice: () => ipcRenderer.invoke('voice:choose'),
  speak: (text, voice, language, reference) => ipcRenderer.invoke('tts:speak', { text, voice, language, reference }),
  stopSpeech: () => ipcRenderer.invoke('tts:stop'),
  setDirty: dirty => ipcRenderer.send('document:dirty', Boolean(dirty)),
});
