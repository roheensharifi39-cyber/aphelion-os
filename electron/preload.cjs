const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke('aphelion:' + name, ...args);
contextBridge.exposeInMainWorld('aphelion', {
  status: () => invoke('status'), configure: input => invoke('configure', input),
  chat: input => invoke('chat', input), cancel: id => invoke('cancel', id),
  onDelta: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('aphelion:delta', listener); return () => ipcRenderer.removeListener('aphelion:delta', listener); },
  selectVault: () => invoke('selectVault'), listNotes: () => invoke('listNotes'),
  readNote: path => invoke('readNote', path), saveNote: note => invoke('saveNote', note),
  speak: text => invoke('speak', text), transcribe: audio => invoke('transcribe', audio),
  openExternal: url => invoke('openExternal', url), windowAction: action => invoke('windowAction', action),
});
