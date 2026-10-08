const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke('aphelion:' + name, ...args);
contextBridge.exposeInMainWorld('aphelion', {
  status: () => invoke('status'), configure: input => invoke('configure', input),
  login: agent => invoke('login', agent),
  runtime: () => invoke('runtime'), mission: request => invoke('mission', request),
  onRuntimeEvent: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('aphelion:runtimeEvent', listener); return () => ipcRenderer.removeListener('aphelion:runtimeEvent', listener); },
  chat: input => invoke('chat', input), cancel: id => invoke('cancel', id),
  onDelta: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('aphelion:delta', listener); return () => ipcRenderer.removeListener('aphelion:delta', listener); },
  selectVault: () => invoke('selectVault'), listNotes: () => invoke('listNotes'),
  vaultGraph: () => invoke('vaultGraph'),
  readNote: path => invoke('readNote', path), saveNote: note => invoke('saveNote', note),
  project: () => invoke('project'), selectProject: () => invoke('selectProject'), createProject: name => invoke('createProject', name),
  listProjectFiles: path => invoke('listProjectFiles', path), readProjectFile: path => invoke('readProjectFile', path), runProjectCommand: command => invoke('runProjectCommand', command), automations: () => invoke('automations'), runAutomation: id => invoke('runAutomation', id),
  obsidian: () => invoke('obsidian'), openObsidian: path => invoke('openObsidian', path),
  openExternal: url => invoke('openExternal', url), windowAction: action => invoke('windowAction', action),
});
