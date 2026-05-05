const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.txt')) {
      ipcRenderer.send('drop-file', file.path);
    }
  });
});
