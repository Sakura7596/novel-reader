const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronReader', {
  onImportFile(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('import-file', listener);
    return () => ipcRenderer.removeListener('import-file', listener);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.txt')) {
      const filePath = webUtils.getPathForFile(file);
      if (filePath) ipcRenderer.send('drop-file', filePath);
    }
  });
});
