const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  getDataDir: () => ipcRenderer.sendSync('get-data-dir'),
  // PTY
  ptySpawn: (cols, rows) => ipcRenderer.send('pty-spawn', { cols, rows }),
  ptyWrite: (data) => ipcRenderer.send('pty-write', data),
  ptyResize: (cols, rows) => ipcRenderer.send('pty-resize', { cols, rows }),
  onPtyData: (cb) => ipcRenderer.on('pty-data', (_e, data) => cb(data)),
  // Window mode
  setWindowMode: (mode) => ipcRenderer.send('set-window-mode', mode),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  // Terminal shortcut
  setTerminalShortcut: (accelerator) => ipcRenderer.send('set-terminal-shortcut', accelerator),
  onTerminalToggle: (cb) => ipcRenderer.on('terminal-toggle-shortcut', () => cb()),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_e, isFull) => cb(isFull)),
});
