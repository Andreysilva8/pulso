const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pulsoPicker', Object.freeze({
  onSources(callback) {
    if (typeof callback !== 'function') return
    ipcRenderer.once('pulso-picker:sources', (_event, payload) => callback(payload))
  },
  select(sourceId, includeAudio) {
    if (typeof sourceId !== 'string' || sourceId.length > 256) return
    ipcRenderer.send('pulso-picker:select', {
      sourceId,
      includeAudio: Boolean(includeAudio),
    })
  },
  cancel() {
    ipcRenderer.send('pulso-picker:cancel')
  },
}))
