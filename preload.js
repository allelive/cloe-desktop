const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  getDataDir: () => ipcRenderer.sendSync('get-data-dir'),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  getWorkAreaSize: () => ipcRenderer.invoke('get-work-area-size'),
});
