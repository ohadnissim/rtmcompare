"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('rtmprofileAPI', {
    selectFiles: () => electron_1.ipcRenderer.invoke('select-files'),
    // Electron 32+ removed `File.path` from the renderer for security;
    // dragged files have to go through `webUtils.getPathForFile` to
    // get an absolute on-disk path. Without this exposure the drop
    // handler in App.tsx returns empty paths and nothing gets added —
    // which is exactly the bug "drag-drop does nothing, only Browse
    // works" that beta testers hit on RTMprofile 1.0.0.
    getDroppedFilePath: (file) => electron_1.webUtils.getPathForFile(file),
    buildProfile: (args) => electron_1.ipcRenderer.invoke('build-profile', args),
    showSavedProfile: (jsonPath) => electron_1.ipcRenderer.invoke('show-saved-profile', jsonPath),
    onProgress: (cb) => {
        const listener = (_e, msg) => cb(msg);
        electron_1.ipcRenderer.on('profile-progress', listener);
        return () => electron_1.ipcRenderer.removeListener('profile-progress', listener);
    },
});
