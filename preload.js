// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startProxyTest: (payload) => ipcRenderer.invoke('start-proxy-test', payload),
  stopProxyTest: () => ipcRenderer.invoke('stop-proxy-test'),
  startBots: (cfg) => ipcRenderer.invoke('start-bots', cfg),
  stopBots: () => ipcRenderer.invoke('stop-bots'),
  onProxyTestResult: (cb) => ipcRenderer.on('proxy-test-result', (e,data) => cb(data)),
  onProxyTestDone: (cb) => ipcRenderer.on('proxy-test-done', (e,data) => cb(data)),
  onProxyTestReplace: (cb) => ipcRenderer.on('proxy-test-replace', (e,data) => cb(data)),
  onBotStatus: (cb) => ipcRenderer.on('bot-status', (e,data) => cb(data)),
  onStats: (cb) => ipcRenderer.on('stats', (e,data) => cb(data))
});
