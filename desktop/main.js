const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '小说阅读器',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, '..', 'reader.html'));

  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function importFile(filePath) {
  if (!win || !filePath.toLowerCase().endsWith('.txt')) return;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath);
    win.webContents.executeJavaScript(`
      importFile(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, {type: 'text/plain'}));
    `).catch(err => console.error('导入失败:', err));
  } catch (err) {
    dialog.showErrorBox('导入失败', '无法读取文件:\n' + err.message);
  }
}

ipcMain.on('drop-file', (e, filePath) => importFile(filePath));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
